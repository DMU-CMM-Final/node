const { v4: uuidv4 } = require('uuid');

module.exports = function(io, socket, context) {
    socket.on('vote', async (data) => {
        const currentTeamId = context.getCurrentTeamId();
        const currentProjectId = context.getCurrentProjectId();
        let votes = context.votesRef();

        if (!currentTeamId || !currentProjectId) return;
        const { fnc, node, cLocate, cScale, cTitle, cList, type = 'vote', user, num } = data;

        // 신규 생성
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
                list: cList || [],
                count: [0, 0, 0, 0],
                users: []
            };
            try {
                await context.queryPromise(
                    'INSERT INTO Vote (node, pId, tId, title, list1, list2, list3, list4, list1Num, list2Num, list3Num, list4Num) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [newNode, currentProjectId, currentTeamId, cTitle,
                     cList?.[0]?.content || '', cList?.[1]?.content || '', cList?.[2]?.content || '', cList?.[3]?.content || '',
                     0, 0, 0, 0]
                );
                await context.queryPromise(
                    'INSERT INTO ProjectInfo (node, pId, tId, dType, locate, scale) VALUES (?, ?, ?, ?, ?, ?)',
                    [newNode, currentProjectId, currentTeamId, 'vote', JSON.stringify({ x, y }), JSON.stringify({ width, height })]
                );
            } catch (error) {
                console.error('새 투표 저장 실패:', error);
            }
            votes.push(vote);
            context.setVotes(votes);
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
        }

        // 수정
        else if (fnc === 'update') {
            const idx = votes.findIndex(v => v.node === node && v.tId == currentTeamId && v.pId == currentProjectId);
            if (idx >= 0) {
                const vote = votes[idx];
                if (cTitle !== undefined) vote.title = cTitle;
                if (cList !== undefined) vote.list = cList;
                try {
                    await context.queryPromise(
                        'UPDATE Vote SET title = ?, list1 = ?, list2 = ?, list3 = ?, list4 = ? WHERE node = ? AND pId = ? AND tId = ?',
                        [vote.title, vote.list?.[0]?.content || '', vote.list?.[1]?.content || '', vote.list?.[2]?.content || '', vote.list?.[3]?.content || '', node, currentProjectId, currentTeamId]
                    );
                } catch (error) {
                    console.error('투표 업데이트 실패:', error);
                }
                const responseData = {
                    type, fnc, node,
                    tId: currentTeamId,
                    pId: currentProjectId,
                    cTitle: vote.title,
                    cList: vote.list
                };
                io.to(String(currentTeamId)).emit('updateVote', responseData);
            }
        }

        // 이동
        else if (fnc === 'move') {
            const idx = votes.findIndex(v => v.node === node && v.tId == currentTeamId && v.pId == currentProjectId);
            if (idx >= 0) {
                const vote = votes[idx];
                if (cLocate) {
                    vote.x = cLocate.x;
                    vote.y = cLocate.y;
                }
                try {
                    await context.queryPromise(
                        'UPDATE ProjectInfo SET locate = ? WHERE node = ? AND pId = ? AND tId = ?',
                        [JSON.stringify({ x: vote.x, y: vote.y }), node, currentProjectId, currentTeamId]
                    );
                } catch (error) {
                    console.error('투표 이동 실패:', error);
                }
                const responseData = {
                    type, fnc, node,
                    tId: currentTeamId,
                    pId: currentProjectId,
                    cLocate: { x: vote.x, y: vote.y }
                };
                io.to(String(currentTeamId)).emit('moveVote', responseData);
            }
        }

        // 크기 조정
        else if (fnc === 'resize') {
            const idx = votes.findIndex(v => v.node === node && v.tId == currentTeamId && v.pId == currentProjectId);
            if (idx >= 0) {
                const vote = votes[idx];
                if (cScale) {
                    vote.width = cScale.width;
                    vote.height = cScale.height;
                }
                try {
                    await context.queryPromise(
                        'UPDATE ProjectInfo SET scale = ? WHERE node = ? AND pId = ? AND tId = ?',
                        [JSON.stringify({ width: vote.width, height: vote.height }), node, currentProjectId, currentTeamId]
                    );
                } catch (error) {
                    console.error('투표 크기 조정 실패:', error);
                }
                const responseData = {
                    type, fnc, node,
                    tId: currentTeamId,
                    pId: currentProjectId,
                    cScale: { width: vote.width, height: vote.height }
                };
                io.to(String(currentTeamId)).emit('resizeVote', responseData);
            }
        }

        // 삭제
        else if (fnc === 'delete') {
            const idx = votes.findIndex(v => v.node === node && v.tId == currentTeamId && v.pId == currentProjectId);
            if (idx >= 0) {
                votes.splice(idx, 1);
                context.setVotes(votes);
                try {
                    await context.queryPromise(
                        'DELETE FROM Vote WHERE node = ? AND pId = ? AND tId = ?',
                        [node, currentProjectId, currentTeamId]
                    );
                    await context.queryPromise(
                        'DELETE FROM ProjectInfo WHERE node = ? AND pId = ? AND tId = ?',
                        [node, currentProjectId, currentTeamId]
                    );
                } catch (error) {
                    console.error('투표 삭제 실패:', error);
                }
                const responseData = {
                    type, fnc, node,
                    tId: currentTeamId,
                    pId: currentProjectId
                };
                io.to(String(currentTeamId)).emit('deleteVote', responseData);
            }
        }
        else if (fnc === 'choice') {
            const idx = votes.findIndex(v => v.node === node && v.tId == currentTeamId && v.pId == currentProjectId);
            if (idx >= 0) {
                const vote = votes[idx];
                // 기존 투표 내역 조회 (메모리)
                const userIdx = vote.users.findIndex(u => u.uId === currentUserId);
                // 기존 투표 내역 있으면 취소 처리
            if (userIdx >= 0) {
                vote.count[vote.users[userIdx].num - 1] -= 1;
                vote.users.splice(userIdx, 1);
                // DB에서 삭제
                await context.queryPromise(
                    'DELETE FROM VoteUser WHERE node = ? AND pId = ? AND tId = ? AND uId = ?',
                    [node, currentProjectId, currentTeamId, currentUserId]
                );}
                // 새 항목 선택
            if (num >= 1 && num <= 4) {
                vote.count[num - 1] += 1;
                vote.users.push({ uId: currentUserId, num });
                // DB에 저장
                await context.queryPromise(
                'INSERT INTO VoteUser (node, pId, tId, uId, num) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE num = VALUES(num)',
                [node, currentProjectId, currentTeamId, currentUserId, num]);}
                // count 업데이트
            await context.queryPromise(
                'UPDATE Vote SET list1Num = ?, list2Num = ?, list3Num = ?, list4Num = ? WHERE node = ? AND pId = ? AND tId = ?',
                [vote.count[0], vote.count[1], vote.count[2], vote.count[3], node, currentProjectId, currentTeamId]
                );
            const responseData = {
                type, fnc, node,
                tId: currentTeamId,
                pId: currentProjectId,
                count: vote.count,
                user: currentUserId,
                num
            };
                io.to(String(currentTeamId)).emit('choiceVote', responseData);
            }
        }  
    });
};
