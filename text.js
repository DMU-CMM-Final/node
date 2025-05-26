const { v4: uuidv4 } = require('uuid');

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
                io.to(String(currentTeamId)).emit('updateTextBox', responseData);
            }
        }

        // 이동
        else if (fnc === 'move') {
            const idx = textBoxes.findIndex(t => t.node === node && t.tId == currentTeamId && t.pId == currentProjectId);
            if (idx >= 0) {
                const box = textBoxes[idx];
                if (cLocate) {
                    box.x = cLocate.x;
                    box.y = cLocate.y;
                }
                try {
                    await context.queryPromise(
                        'UPDATE ProjectInfo SET locate = ? WHERE node = ? AND pId = ? AND tId = ?',
                        [JSON.stringify({ x: box.x, y: box.y }), node, currentProjectId, currentTeamId]
                    );
                } catch (error) {
                    console.error('텍스트 박스 이동 실패:', error);
                }
                const responseData = {
                    type, fnc, node,
                    tId: currentTeamId,
                    pId: currentProjectId,
                    cLocate: { x: box.x, y: box.y }
                };
                io.to(String(currentTeamId)).emit('moveTextBox', responseData);
            }
        }

        // 크기 조정
        else if (fnc === 'resize') {
            const idx = textBoxes.findIndex(t => t.node === node && t.tId == currentTeamId && t.pId == currentProjectId);
            if (idx >= 0) {
                const box = textBoxes[idx];
                if (cScale) {
                    box.width = cScale.width;
                    box.height = cScale.height;
                }
                try {
                    await context.queryPromise(
                        'UPDATE ProjectInfo SET scale = ? WHERE node = ? AND pId = ? AND tId = ?',
                        [JSON.stringify({ width: box.width, height: box.height }), node, currentProjectId, currentTeamId]
                    );
                } catch (error) {
                    console.error('텍스트 박스 크기 조정 실패:', error);
                }
                const responseData = {
                    type, fnc, node,
                    tId: currentTeamId,
                    pId: currentProjectId,
                    cScale: { width: box.width, height: box.height }
                };
                io.to(String(currentTeamId)).emit('resizeTextBox', responseData);
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
                } catch (error) {
                    console.error('텍스트 박스 삭제 실패:', error);
                }
                const responseData = {
                    type, fnc, node,
                    tId: currentTeamId,
                    pId: currentProjectId
                };
                io.to(String(currentTeamId)).emit('deleteTextBox', responseData);
            }
        }
    });
};
