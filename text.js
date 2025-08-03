const { v4: uuidv4 } = require('uuid');
const insertLog = require('./logger');


module.exports = function(io, socket, context) {
    socket.on('textEvent', async (data) => {
        const currentTeamId = context.getCurrentTeamId();
        const currentProjectId = context.getCurrentProjectId();
        const currentUserId = context.getCurrentUserId();
        let textBoxes = context.textBoxesRef();

        if (!currentTeamId || !currentProjectId) return;
        const { fnc, node, cLocate, cFont, cColor, cSize, cContent, cScale, type = 'text' } = data;

        // 신규 생성
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
            context.setTextBoxes(textBoxes);
            try {
                await context.queryPromise(
                    'INSERT INTO Text (node, pId, tId, uId, content, font, color, fontSize) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    [newNode, currentProjectId, currentTeamId, currentUserId, cContent || '', cFont || 'Arial', cColor || '#000000', cSize || 14]
                );
                await context.queryPromise(
                    'INSERT INTO ProjectInfo (node, pId, tId, dType, locate, scale) VALUES (?, ?, ?, ?, ?, ?)',
                    [newNode, currentProjectId, currentTeamId, 'text', JSON.stringify({ x, y }), JSON.stringify({ width, height })]
                );
                //로그찍깅
                await insertLog({
                    node: newNode,
                    pId: currentProjectId,
                    tId: currentTeamId,
                    uId: currentUserId,
                    action: 'text-new'
                }, context.queryPromise);
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
        }

        // 수정
        else if (fnc === 'update') {
            const idx = textBoxes.findIndex(t => t.node === node && t.tId == currentTeamId && t.pId == currentProjectId);
            if (idx >= 0) {
                const box = textBoxes[idx];
                if (cContent !== undefined) box.text = cContent;
                if (cFont !== undefined) box.font = cFont;
                if (cColor !== undefined) box.color = cColor;
                if (cSize !== undefined) box.size = cSize;
                try {
                    await context.queryPromise(
                        'UPDATE Text SET content = ?, font = ?, color = ?, fontSize = ? WHERE node = ? AND pId = ? AND tId = ?',
                        [box.text, box.font, box.color, box.size, node, currentProjectId, currentTeamId]
                    );
                    
                    await insertLog({
                        node,
                        pId: currentProjectId,
                        tId: currentTeamId,
                        uId: context.getCurrentUserId(),
                        action: 'text-update'
                    }, context.queryPromise);
                } catch (error) {
                    console.error('텍스트 박스 업데이트 실패:', error);
                }
                const responseData = {
                    type, fnc, node,
                    tId: currentTeamId,
                    pId: currentProjectId,
                    cContent: box.text,
                    cFont: box.font,
                    cColor: box.color,
                    cSize: box.size
                };

                
                socket.to(String(currentTeamId)).emit('updateTextBox', responseData);
            }
        }

        else if (fnc === 'move') {
            const idx = textBoxes.findIndex(t => t.node === node && t.tId == currentTeamId && t.pId == currentProjectId);
            
            if (idx >= 0) {
                const box = textBoxes[idx];
                // 위치 이동
                if (cLocate) {
                box.x = cLocate.x;
                box.y = cLocate.y;
                }
                // 크기 조정
                if (cScale) {
                box.width = cScale.width;
                box.height = cScale.height;
                }
                try {
                // locate와 scale을 한 번에 업데이트
                await context.queryPromise(
                    'UPDATE ProjectInfo SET locate = ?, scale = ? WHERE node = ? AND pId = ? AND tId = ?',
                    [JSON.stringify({ x: box.x, y: box.y }), JSON.stringify({ width: box.width, height: box.height }), node, currentProjectId, currentTeamId]
                );
                
                await insertLog({
                    node,
                    pId: currentProjectId,
                    tId: currentTeamId,
                    uId: currentUserId,
                    action: 'text-move' // 또는 'move-start', 'move-end' 등 프론트에서 구분 가능
                }, context.queryPromise);
            } catch (error) {
                console.error('텍스트 박스 이동/크기조정 실패:', error);
            }
                const responseData = {
                    type, fnc, node,
                    tId: currentTeamId,
                    pId: currentProjectId,
                    cLocate: { x: box.x, y: box.y },
                    cScale: { width: box.width, height: box.height }
                };
                

                socket.to(String(currentTeamId)).emit('moveTextBox', responseData);
                }
            }

        // 삭제
        else if (fnc === 'delete') {
            const idx = textBoxes.findIndex(t => t.node === node && t.tId == currentTeamId && t.pId == currentProjectId);
            if (idx >= 0) {
                textBoxes.splice(idx, 1);
                context.setTextBoxes(textBoxes);
                try {
                    await context.queryPromise(
                        'DELETE FROM Text WHERE node = ? AND pId = ? AND tId = ?',
                        [node, currentProjectId, currentTeamId]
                    );
                    await context.queryPromise(
                        'DELETE FROM ProjectInfo WHERE node = ? AND pId = ? AND tId = ?',
                        [node, currentProjectId, currentTeamId]
                    );
                    
                    await insertLog({
                        node,
                        pId: currentProjectId,
                        tId: currentTeamId,
                        uId: currentUserId,
                        action: 'text-del'
                    }, context.queryPromise);
                } catch (error) {
                    console.error('텍스트 박스 삭제 실패:', error);
                }
                const responseData = {
                    type, fnc, node,
                    tId: currentTeamId,
                    pId: currentProjectId
                };

                
                socket.to(String(currentTeamId)).emit('removeTextBox', responseData);
            }
        }
    });
};
