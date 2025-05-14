module.exports = (io, socket, context) => {
    const { votes, queryPromise, uuidv4 } = context;
    const getTeamId = () => context.currentTeamId;

    socket.on('vote', async (data) => {
        const currentTeamId = getTeamId();
        if (!currentTeamId) return;

        const { fnc, node, cLocate, cScale, cTitle, cList, type = 'vote' } = data;

        if (fnc === 'new') {
            const newNode = uuidv4();
            const x = cLocate?.x || 0;
            const y = cLocate?.y || 0;
            const width = cScale?.width || 300;
            const height = cScale?.height || 200;
            const vote = {
                node: newNode,
                x, y, width, height,
                title: cTitle || '',
                list: cList || [],
                tId: currentTeamId
            };
            const list1 = cList?.[0]?.content || '';
            const list2 = cList?.[1]?.content || '';
            const list3 = cList?.[2]?.content || '';
            const list4 = cList?.[3]?.content || '';
            try {
                await queryPromise(
                    'INSERT INTO Vote (node, pId, tId, title, list1, list2, list3, list4, list1Num, list2Num, list3Num, list4Num) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [newNode, 1, currentTeamId, cTitle, list1, list2, list3, list4, 0, 0, 0, 0]
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
                tId: currentTeamId
            };
            io.to(String(currentTeamId)).emit('addVote', responseData);

        } else if (fnc === 'update') {
            const vote = votes.find(v => v.node === node && v.tId == currentTeamId);
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
                        [cTitle, list1, list2, list3, list4, node, 1, currentTeamId]
                    );
                } catch (error) {
                    console.error('투표 업데이트 실패:', error);
                }
                const responseData = {
                    type, fnc, node,
                    cTitle: cTitle,
                    cList: cList,
                    tId: currentTeamId
                };
                io.to(String(currentTeamId)).emit('updateVote', responseData);
            }
        } else if (fnc === 'move') {
            const vote = votes.find(v => v.node === node && v.tId == currentTeamId);
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
                        [JSON.stringify({ x: vote.x, y: vote.y }), JSON.stringify({ width: vote.width, height: vote.height }), node, 1, currentTeamId]
                    );
                } catch (error) {
                    console.error('투표 위치/크기 업데이트 실패:', error);
                }
                const responseData = {
                    type, fnc, node,
                    cLocate: { x: vote.x, y: vote.y },
                    cScale: { width: vote.width, height: vote.height },
                    tId: currentTeamId
                };
                io.to(String(currentTeamId)).emit('moveVote', responseData);
            }
        } else if (fnc === 'delete') {
            votes = votes.filter(v => !(v.node === node && v.tId == currentTeamId));
            try {
                await queryPromise('DELETE FROM Vote WHERE node = ? AND pId = ? AND tId = ?', [node, 1, currentTeamId]);
                await queryPromise('DELETE FROM ProjectInfo WHERE node = ? AND pId = ? AND tId = ?', [node, 1, currentTeamId]);
            } catch (error) {
                console.error('투표 삭제 실패:', error);
            }
            const responseData = { type, fnc, node, tId: currentTeamId };
            io.to(String(currentTeamId)).emit('removeVote', responseData);
        } else if (fnc === 'choice') {
            const { user, num } = data;
            const column = `list${num}Num`;
            try {
                await queryPromise(
                    `UPDATE Vote SET ${column} = ${column} + 1 WHERE node = ? AND pId = ? AND tId = ?`,
                    [node, 1, currentTeamId]
                );
                const [result] = await queryPromise('SELECT * FROM Vote WHERE node = ? AND pId = ? AND tId = ?', [node, 1, currentTeamId]);
                const responseData = {
                    type, fnc, node,
                    cTitle: result.title,
                    cList: [
                        { num: 1, content: result.list1, count: result.list1Num },
                        { num: 2, content: result.list2, count: result.list2Num },
                        { num: 3, content: result.list3, count: result.list3Num },
                        { num: 4, content: result.list4, count: result.list4Num }
                    ],
                    tId: currentTeamId
                };
                io.to(String(currentTeamId)).emit('updateVote', responseData);
            } catch (error) {
                console.error('투표 선택 실패:', error);
            }
        }
    });
};
