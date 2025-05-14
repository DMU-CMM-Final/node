const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { db, queryPromise } = require('./dbConnector'); // dbConnector.js에서 연결을 가져옴

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { 
  cors: { origin: '*', methods: ['GET', 'POST'] }
});
const { v4: uuidv4 } = require('uuid'); //uuid 생성 함수 부르깅깅


app.use(express.static(__dirname));//현재파일 정적파일 제공

let textBoxes = [];

async function initializeTextBoxes() {
    try {
        const textResults = await queryPromise('SELECT * FROM Text', []); // Text 테이블 전체 조회
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
        console.log('초기화 성공:', textBoxes);
    } catch (error) {
        console.error('초기화 실패:', error);
    }
}

initializeTextBoxes().then(() => {
    io.on('connection', (socket) => {
        let currentTeamId = null;
        let currentUserId = null;

        // 프론트엔드에서 tId, uId만 전달
        socket.on('joinTeam', async ({ uId, tId }) => {
            currentUserId = uId;
            currentTeamId = tId;

            // 한 명은 한 팀만 들어갈 수 있으므로, 바로 tId 사용
            // (검증 필요시 TeamMem에서 SELECT tId WHERE uId = ?)
            const teamRows = await queryPromise('SELECT tId FROM TeamMem WHERE uId = ?', [uId]);
            if (!teamRows.length || teamRows[0].tId != tId) {
                socket.emit('error', { message: '팀이 없거나 잘못된 팀입니다.' });
                return;
            }
            socket.join(String(currentTeamId));
            const teamTextBoxes = textBoxes.filter(box => box.tId == currentTeamId);
            socket.emit('initialize', teamTextBoxes);
        });

        socket.on('textEvent', async (data) => {
            if (!currentTeamId) return;
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
                    uId: currentUserId,
                    x, y, width, height,
                    font: cFont || 'Arial',
                    color: cColor || '#000000',
                    size: cSize || 14,
                    text: cContent || ''
                };
                textBoxes.push(box);
                const responseData = {
                    type, fnc, node: newNode,
                    tId: currentTeamId,
                    cLocate: { x, y },
                    cScale: { width, height },
                    cFont: box.font, cColor: box.color, cSize: box.size,
                    cContent: box.text
                };
                try {
                    await queryPromise(
                        'INSERT INTO Text (node, pId, tId, uId, content, font, color, fontSize) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                        [newNode, 1, currentTeamId, currentUserId, cContent || '', cFont || 'Arial', cColor || '#000000', cSize || 14]
                    );
                    await queryPromise(
                        'INSERT INTO ProjectInfo (node, pId, tId, dType, locate, scale) VALUES (?, ?, ?, ?, ?, ?)',
                        [newNode, 1, currentTeamId, 'text', JSON.stringify({ x, y }), JSON.stringify({ width, height })]
                    );
                } catch (error) {
                    console.error('새 텍스트 박스 저장 실패:', error);
                }
                io.to(String(currentTeamId)).emit('addTextBox', responseData);

            } else if (fnc === 'update') {
                const box = textBoxes.find(b => b.node === node && b.tId == currentTeamId);
                if (box) {
                    if (cFont !== undefined) box.font = cFont;
                    if (cColor !== undefined) box.color = cColor;
                    if (cSize !== undefined) box.size = cSize;
                    if (cContent !== undefined) box.text = cContent;
                    const responseData = {
                        type, fnc, node,
                        cFont: box.font, cColor: box.color, cSize: box.size,
                        cContent: box.text,
                        tId: currentTeamId
                        
                    };
                    try {
                        await queryPromise(
                            'UPDATE Text SET content = ?, font = ?, color = ?, fontSize = ? WHERE node = ? AND tId = ?',
                            [box.text, box.font || 'Arial', box.color || '#000000', box.size || 14, node, currentTeamId]
                        );
                    } catch (error) {
                        console.error('텍스트 박스 업데이트 실패:', error);
                    }
                    socket.to(String(currentTeamId)).emit('updateTextBox', responseData);
                }
            } else if (fnc === 'move') {
                const box = textBoxes.find(b => b.node === node && b.tId == currentTeamId);
                if (box) {
                    if (cLocate) {
                        box.x = Number(cLocate.x);
                        box.y = Number(cLocate.y);
                    }
                    if (cScale) {
                        if (cScale.width !== undefined) box.width = cScale.width;
                        if (cScale.height !== undefined) box.height = cScale.height;
                    }
                    const responseData = {
                        type, fnc, node,
                        tId: currentTeamId,
                        uId: currentUserId,
                        cLocate: { x: box.x, y: box.y },
                        cScale: { width: box.width, height: box.height }
                    };
                    try {
                        await queryPromise(
                            'UPDATE ProjectInfo SET locate = ?, scale = ? WHERE node = ? AND tId = ?',
                            [JSON.stringify({ x: box.x, y: box.y }), JSON.stringify({ width: box.width, height: box.height }), node, currentTeamId]
                        );
                    } catch (error) {
                        console.error('텍스트 박스 위치/크기 업데이트 실패:', error);
                    }
                    socket.to(String(currentTeamId)).emit('moveTextBox', responseData);
                }
            } else if (fnc === 'delete') {
                const initialLength = textBoxes.length;
                textBoxes = textBoxes.filter(b => !(b.node === node && b.tId == currentTeamId));
                if (initialLength !== textBoxes.length) {
                    const responseData = { type, fnc, node, tId: currentTeamId };
                    try {
                        await queryPromise('DELETE FROM Text WHERE node = ? AND tId = ?', [node, currentTeamId]);
                        await queryPromise('DELETE FROM ProjectInfo WHERE node = ? AND tId = ?', [node, currentTeamId]);
                    } catch (error) {
                        console.error('텍스트 박스 삭제 실패:', error);
                    }
                    socket.to(String(currentTeamId)).emit('removeTextBox', responseData);
                }
            }
        });

        socket.on('disconnect', () => {
            if (currentTeamId) socket.leave(String(currentTeamId));
        });
    });
});

server.listen(3000, () => {
    console.log('서버가 3000번 포트에서 실행 중입니다.');
});