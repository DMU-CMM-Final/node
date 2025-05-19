const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { db, queryPromise } = require('./dbConnector');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { 
  cors: { origin: '*', methods: ['GET', 'POST'] }
});
app.use(express.static(__dirname));

// 텍스트박스 데이터 메모리
let textBoxes = [];
async function initializeTextBoxes() {
    try {
        const textResults = await queryPromise('SELECT * FROM Text', []);
        const textBoxesData = await Promise.all(textResults.map(async (row) => {
            const infoResults = await queryPromise(
                'SELECT locate, scale FROM ProjectInfo WHERE node = ? AND tId = ?',
                [row.node, row.tId]
            );
            let locate = { x: 0, y: 0 };
            let scale = { width: 180, height: 100 };
            if (infoResults.length > 0) {
                if (infoResults[0].locate) locate = JSON.parse(infoResults[0].locate);
                if (infoResults[0].scale) scale = JSON.parse(infoResults[0].scale);
            }
            return {
                node: row.node,
                tId: row.tId,
                pId: row.pId,           // 프로젝트 ID 추가
                uId: row.uId,
                x: locate.x,
                y: locate.y,
                width: scale.width,
                height: scale.height,
                font: row.font || 'Arial',
                color: row.color || '#000000',
                size: row.fontSize || 14,
                text: row.content || ''
            };
        }));
        textBoxes = textBoxesData;
        console.log('텍스트박스 초기화 성공:', textBoxes);
    } catch (error) {
        console.error('텍스트박스 초기화 실패:', error);
    }
}

// 투표 데이터 메모리
let votes = [];
async function initializeVotes() {
    try {
        const voteResults = await queryPromise('SELECT * FROM Vote', []);
        votes = voteResults.map(row => ({
            node: row.node,
            tId: row.tId,
            pId: row.pId,           // 프로젝트 ID 추가
            x: 0,
            y: 0,
            width: 300,
            height: 200,
            title: row.title || '',
            list: [
                { num: 1, content: row.list1, count: row.list1Num },
                { num: 2, content: row.list2, count: row.list2Num },
                { num: 3, content: row.list3, count: row.list3Num },
                { num: 4, content: row.list4, count: row.list4Num }
            ]
        }));
        console.log('투표 초기화 성공:', votes);
    } catch (error) {
        console.error('투표 초기화 실패:', error);
    }
}

initializeTextBoxes().then(() => initializeVotes().then(() => {
    io.on('connection', (socket) => {
        let currentTeamId = null;
        let currentUserId = null;
        let currentProjectId = null;

        // 팀 및 프로젝트 입장
        socket.on('joinTeam', async ({ uId, tId, pId }) => {
            currentUserId = uId;
            currentTeamId = tId;
            currentProjectId = pId;

            const teamRows = await queryPromise('SELECT tId FROM TeamMem WHERE uId = ?', [uId]);
            if (!teamRows.length || teamRows[0].tId != tId) {
                socket.emit('error', { message: '팀이 없거나 잘못된 팀입니다.' });
                return;
            }

            socket.join(String(currentTeamId));

            // 팀+프로젝트 필터링 적용
            const teamTextBoxes = textBoxes.filter(box => box.tId == currentTeamId && box.pId == currentProjectId);
            socket.emit('initializeTexts', teamTextBoxes);

            const teamVotes = votes.filter(vote => vote.tId == currentTeamId && vote.pId == currentProjectId);
            socket.emit('initializeVotes', teamVotes);
        });

        // 텍스트박스 이벤트 처리
        socket.on('textEvent', async (data) => {
            if (!currentTeamId || !currentProjectId) return;
            const { fnc, node, cLocate, cFont, cColor, cSize, cContent, cScale, type = 'text' } = data;

            if (fnc === 'new') {
                const newNode = uuidv4();
                const width = cScale?.width || 180;
                const height = cScale?.height || 100;
                const x = cLocate?.x || 0;
                const y = cLocate?.y || 0;
                const box = {
                    node: newNode,
                    tId: currentTeamId,
                    pId: currentProjectId,
                    uId: currentUserId,
                    x, y, width, height,
                    font: cFont || 'Arial',
                    color: cColor || '#000000',
                    size: cSize || 14,
                    text: cContent || ''
                };
                textBoxes.push(box);
                try {
                    await queryPromise(
                        'INSERT INTO Text (node, pId, tId, uId, content, font, color, fontSize) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                        [newNode, currentProjectId, currentTeamId, currentUserId, cContent || '', cFont || 'Arial', cColor || '#000000', cSize || 14]
                    );
                    await queryPromise(
                        'INSERT INTO ProjectInfo (node, pId, tId, dType, locate, scale) VALUES (?, ?, ?, ?, ?, ?)',
                        [newNode, currentProjectId, currentTeamId, 'text', JSON.stringify({ x, y }), JSON.stringify({ width, height })]
                    );
                } catch (error) {
                    console.error('새 텍스트 박스 저장 실패:', error);
                }
                const responseData = {
                    type, fnc, node: newNode,
                    tId: currentTeamId,
                    pId: currentProjectId,
                    cLocate: { x, y },
                    cScale: { width, height },
                    cFont: box.font, cColor: box.color, cSize: box.size,
                    cContent: box.text
                };
                io.to(String(currentTeamId)).emit('addTextBox', responseData);

            } else if (fnc === 'update') {
                const box = textBoxes.find(b => b.node === node && b.tId == currentTeamId && b.pId == currentProjectId);
                if (box) {
                    if (cFont !== undefined) box.font = cFont;
                    if (cColor !== undefined) box.color = cColor;
                    if (cSize !== undefined) box.size = cSize;
                    if (cContent !== undefined) box.text = cContent;
                    try {
                        await queryPromise(
                            'UPDATE Text SET content = ?, font = ?, color = ?, fontSize = ? WHERE node = ? AND pId = ? AND tId = ?',
                            [box.text, box.font || 'Arial', box.color || '#000000', box.size || 14, node, currentProjectId, currentTeamId]
                        );
                    } catch (error) {
                        console.error('텍스트 박스 업데이트 실패:', error);
                    }
                    const responseData = {
                        type, fnc, node,
                        cFont: box.font, cColor: box.color, cSize: box.size,
                        cContent: box.text,
                        tId: currentTeamId,
                        pId: currentProjectId
                    };
                    socket.to(String(currentTeamId)).emit('updateTextBox', responseData);
                }
            } else if (fnc === 'move') {
                const box = textBoxes.find(b => b.node === node && b.tId == currentTeamId && b.pId == currentProjectId);
                if (box) {
                    if (cLocate) {
                        box.x = Number(cLocate.x);
                        box.y = Number(cLocate.y);
                    }
                    if (cScale) {
                        if (cScale.width !== undefined) box.width = cScale.width;
                        if (cScale.height !== undefined) box.height = cScale.height;
                    }
                    try {
                        await queryPromise(
                            'UPDATE ProjectInfo SET locate = ?, scale = ? WHERE node = ? AND pId = ? AND tId = ?',
                            [JSON.stringify({ x: box.x, y: box.y }), JSON.stringify({ width: box.width, height: box.height }), node, currentProjectId, currentTeamId]
                        );
                    } catch (error) {
                        console.error('텍스트 박스 위치/크기 업데이트 실패:', error);
                    }
                    const responseData = {
                        type, fnc, node,
                        tId: currentTeamId,
                        pId: currentProjectId,
                        uId: currentUserId,
                        cLocate: { x: box.x, y: box.y },
                        cScale: { width: box.width, height: box.height }
                    };
                    socket.to(String(currentTeamId)).emit('moveTextBox', responseData);
                }
            } else if (fnc === 'delete') {
                const initialLength = textBoxes.length;
                textBoxes = textBoxes.filter(b => !(b.node === node && b.tId == currentTeamId && b.pId == currentProjectId));
                if (initialLength !== textBoxes.length) {
                    try {
                        await queryPromise('DELETE FROM Text WHERE node = ? AND pId = ? AND tId = ?', [node, currentProjectId, currentTeamId]);
                        await queryPromise('DELETE FROM ProjectInfo WHERE node = ? AND pId = ? AND tId = ?', [node, currentProjectId, currentTeamId]);
                    } catch (error) {
                        console.error('텍스트 박스 삭제 실패:', error);
                    }
                    const responseData = { type, fnc, node, tId: currentTeamId, pId: currentProjectId };
                    socket.to(String(currentTeamId)).emit('removeTextBox', responseData);
                }
            }
        });
        ////////////////////////////////////////////////////////

        // 투표 이벤트 처리
        socket.on('vote', async (data) => {
            if (!currentTeamId || !currentProjectId) return;
            const { fnc, node, cLocate, cScale, cTitle, cList, type = 'vote' } = data;

            if (fnc === 'new') {
                const newNode = uuidv4();
                const x = cLocate?.x || 0;
                const y = cLocate?.y || 0;
                const width = cScale?.width || 300;
                const height = cScale?.height || 200;
                const vote = {
                    node: newNode,
                    tId: currentTeamId,
                    pId: currentProjectId,
                    x, y, width, height,
                    title: cTitle || '',
                    list: cList || []
                };
                const list1 = cList?.[0]?.content || '';
                const list2 = cList?.[1]?.content || '';
                const list3 = cList?.[2]?.content || '';
                const list4 = cList?.[3]?.content || '';
                try {
                    await queryPromise(
                        'INSERT INTO Vote (node, pId, tId, title, list1, list2, list3, list4, list1Num, list2Num, list3Num, list4Num) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [newNode, currentProjectId, currentTeamId, cTitle, list1, list2, list3, list4, 0, 0, 0, 0]
                    );
                    await queryPromise(
                        'INSERT INTO ProjectInfo (node, pId, tId, dType, locate, scale) VALUES (?, ?, ?, ?, ?, ?)',
                        [newNode, currentProjectId, currentTeamId, 'vote', JSON.stringify({ x, y }), JSON.stringify({ width, height })]
                    );
                } catch (error) {
                    console.error('새 투표 저장 실패:', error);
                }
                votes.push(vote);
                const responseData = {
                    type, fnc, node: newNode,
                    cLocate: { x, y },
                    cScale: { width, height },
                    cTitle: cTitle,
                    cList: cList,
                    tId: currentTeamId,
                    pId: currentProjectId
                };
                io.to(String(currentTeamId)).emit('addVote', responseData);

            } else if (fnc === 'update') {
                const vote = votes.find(v => v.node === node && v.tId == currentTeamId && v.pId == currentProjectId);
                if (vote) {
                    if (cTitle !== undefined) vote.title = cTitle;
                    if (cList !== undefined) vote.list = cList;
                    const list1 = cList?.[0]?.content || '';
                    const list2 = cList?.[1]?.content || '';
                    const list3 = cList?.[2]?.content || '';
                    const list4 = cList?.[3]?.content || '';
                    try {
                        await queryPromise(
                            'UPDATE Vote SET title = ?, list1 = ?, list2 = ?, list3 = ?, list4 = ? WHERE node = ? AND pId = ? AND tId = ?',
                            [cTitle, list1, list2, list3, list4, node, currentProjectId, currentTeamId]
                        );
                    } catch (error) {
                        console.error('투표 업데이트 실패:', error);
                    }
                    const responseData = {
                        type, fnc, node,
                        cTitle: cTitle,
                        cList: cList,
                        tId: currentTeamId,
                        pId: currentProjectId
                    };
                    io.to(String(currentTeamId)).emit('updateVote', responseData);
                }
            } else if (fnc === 'move') {
                const vote = votes.find(v => v.node === node && v.tId == currentTeamId && v.pId == currentProjectId);
                if (vote) {
                    if (cLocate) {
                        vote.x = Number(cLocate.x);
                        vote.y = Number(cLocate.y);
                    }
                    if (cScale) {
                        if (cScale.width !== undefined) vote.width = cScale.width;
                        if (cScale.height !== undefined) vote.height = cScale.height;
                    }
                    try {
                        await queryPromise(
                            'UPDATE ProjectInfo SET locate = ?, scale = ? WHERE node = ? AND pId = ? AND tId = ?',
                            [JSON.stringify({ x: vote.x, y: vote.y }), JSON.stringify({ width: vote.width, height: vote.height }), node, currentProjectId, currentTeamId]
                        );
                    } catch (error) {
                        console.error('투표 위치/크기 업데이트 실패:', error);
                    }
                    const responseData = {
                        type, fnc, node,
                        cLocate: { x: vote.x, y: vote.y },
                        cScale: { width: vote.width, height: vote.height },
                        tId: currentTeamId,
                        pId: currentProjectId
                    };
                    io.to(String(currentTeamId)).emit('moveVote', responseData);
                }
            } else if (fnc === 'delete') {
                const initialLength = votes.length;
                votes = votes.filter(v => !(v.node === node && v.tId == currentTeamId && v.pId == currentProjectId));
                if (initialLength !== votes.length) {
                    try {
                        await queryPromise('DELETE FROM Vote WHERE node = ? AND pId = ? AND tId = ?', [node, currentProjectId, currentTeamId]);
                        await queryPromise('DELETE FROM ProjectInfo WHERE node = ? AND pId = ? AND tId = ?', [node, currentProjectId, currentTeamId]);
                    } catch (error) {
                        console.error('투표 삭제 실패:', error);
                    }
                    const responseData = { type, fnc, node, tId: currentTeamId, pId: currentProjectId };
                    io.to(String(currentTeamId)).emit('removeVote', responseData);
                }
            } else if (fnc === 'choice') {
                // 입력값 검증
                const { user, num } = data;
                if (!user || typeof num !== 'number' || ![1, 2, 3, 4].includes(num)) {
                    socket.emit('error', { message: '잘못된 투표 요청입니다.' });
                    return;
                }
            
                try {
                    // 기존 투표 기록 조회
                    const existing = await queryPromise(
                        'SELECT num FROM VoteUser WHERE node = ? AND pId = ? AND tId = ? AND uId = ?',
                        [node, currentProjectId, currentTeamId, user]
                    );
            
                    if (existing.length === 0) {
                        // 새로 투표
                        await queryPromise(
                            'INSERT INTO VoteUser (node, pId, tId, uId, num) VALUES (?, ?, ?, ?, ?)',
                            [node, currentProjectId, currentTeamId, user, num]
                        );
                        const column = `list${num}Num`;
                        await queryPromise(
                            `UPDATE Vote SET ${column} = ${column} + 1 WHERE node = ? AND pId = ? AND tId = ?`,
                            [node, currentProjectId, currentTeamId]
                        );
                    } else {
                        const oldNum = existing[0].num;
                        if (oldNum === num) {
                            socket.emit('info', { message: '이미 선택한 항목입니다.' });
                            return;
                        }
                        // 기존 항목 투표수 감소
                        const oldColumn = `list${oldNum}Num`;
                        await queryPromise(
                            `UPDATE Vote SET ${oldColumn} = ${oldColumn} - 1 WHERE node = ? AND pId = ? AND tId = ?`,
                            [node, currentProjectId, currentTeamId]
                        );
                        // 새 항목 투표수 증가
                        const newColumn = `list${num}Num`;
                        await queryPromise(
                            `UPDATE Vote SET ${newColumn} = ${newColumn} + 1 WHERE node = ? AND pId = ? AND tId = ?`,
                            [node, currentProjectId, currentTeamId]
                        );
                        // VoteUser 테이블에 선택 항목 업데이트
                        await queryPromise(
                            'UPDATE VoteUser SET num = ? WHERE node = ? AND pId = ? AND tId = ? AND uId = ?',
                            [num, node, currentProjectId, currentTeamId, user]
                        );
                    }
            
                    // 변경된 투표 결과를 DB에서 다시 조회
                    const voteRow = await queryPromise(
                        'SELECT * FROM Vote WHERE node = ? AND pId = ? AND tId = ?',
                        [node, currentProjectId, currentTeamId]
                    );
                    if (!voteRow.length) {
                        socket.emit('error', { message: '투표 정보를 찾을 수 없습니다.' });
                        return;
                    }
            
                    // 메모리 votes 동기화
                    const idx = votes.findIndex(v => v.node === node && v.tId == currentTeamId && v.pId == currentProjectId);
                    if (idx >= 0) {
                        votes[idx].list = [
                            { num: 1, content: voteRow[0].list1, count: voteRow[0].list1Num },
                            { num: 2, content: voteRow[0].list2, count: voteRow[0].list2Num },
                            { num: 3, content: voteRow[0].list3, count: voteRow[0].list3Num },
                            { num: 4, content: voteRow[0].list4, count: voteRow[0].list4Num }
                        ];
                    }
            
                    // 응답 데이터 구성
                    const responseData = {
                        type, fnc: 'choice', node,
                        tId: currentTeamId,
                        pId: currentProjectId,
                        cTitle: voteRow[0].title,
                        cList: [
                            { num: 1, content: voteRow[0].list1, count: voteRow[0].list1Num },
                            { num: 2, content: voteRow[0].list2, count: voteRow[0].list2Num },
                            { num: 3, content: voteRow[0].list3, count: voteRow[0].list3Num },
                            { num: 4, content: voteRow[0].list4, count: voteRow[0].list4Num }
                        ]
                    };
            
                    // 팀 전체에 실시간 브로드캐스트
                    io.to(String(currentTeamId)).emit('updateVote', responseData);
            
                } catch (error) {
                    console.error('투표 선택/변경 실패:', error);
                    socket.emit('error', { message: '투표 처리 중 오류가 발생했습니다.' });
                }
            }

            socket.on('disconnect', () => {
                if (currentTeamId) socket.leave(String(currentTeamId));
            });
        });
    });
}));

server.listen(3000, () => {
    console.log('서버가 3000번 포트에서 실행 중입니다.');
});
