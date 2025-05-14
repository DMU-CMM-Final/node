module.exports = (io, socket, context) => {
    const { textBoxes, queryPromise, uuidv4 } = context;
    const getTeamId = () => context.currentTeamId;

    socket.on('textEvent', async (data) => {
        const currentTeamId = getTeamId();
        if (!currentTeamId) return; // 팀 미지정시 무시

        const { fnc, node, cLocate, cFont, cColor, cSize, cContent, cScale, type = 'text' } = data;

        if (fnc === 'new') {
            const newNode = uuidv4();
            const width = cScale?.width || 180;
            const height = cScale?.height || 100;
            const x = cLocate?.x || 0;
            const y = cLocate?.y || 0;
            const box = {
                node: newNode,
                x, y, width, height,
                font: cFont || 'Arial',
                color: cColor || '#000000',
                size: cSize || 14,
                text: cContent || '',
                tId: currentTeamId
            };
            textBoxes.push(box);

            const responseData = {
                type, fnc, node: newNode,
                cLocate: { x, y },
                cScale: { width, height },
                cFont: box.font, cColor: box.color, cSize: box.size,
                cContent: box.text,
                tId: currentTeamId
            };

            try {
                await queryPromise(
                    'INSERT INTO Text (node, pId, tId, content, font, color, fontSize) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [newNode, 1, currentTeamId, cContent || '', cFont || 'Arial', cColor || '#000000', cSize || 14]
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
                        'UPDATE Text SET content = ?, font = ?, color = ?, fontSize = ? WHERE node = ? AND pId = ? AND tId = ?',
                        [box.text, box.font || 'Arial', box.color || '#000000', box.size || 14, node, 1, currentTeamId]
                    );
                } catch (error) {
                    console.error('텍스트 박스 업데이트 실패:', error);
                }
                io.to(String(currentTeamId)).emit('updateTextBox', responseData);
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
                    cLocate: { x: box.x, y: box.y },
                    cScale: { width: box.width, height: box.height },
                    tId: currentTeamId
                };

                try {
                    await queryPromise(
                        'UPDATE ProjectInfo SET locate = ?, scale = ? WHERE node = ? AND pId = ? AND tId = ?',
                        [JSON.stringify({ x: box.x, y: box.y }), JSON.stringify({ width: box.width, height: box.height }), node, 1, currentTeamId]
                    );
                } catch (error) {
                    console.error('텍스트 박스 위치/크기 업데이트 실패:', error);
                }
                io.to(String(currentTeamId)).emit('moveTextBox', responseData);
            }
        } else if (fnc === 'delete') {
            const initialLength = textBoxes.length;
            textBoxes = textBoxes.filter(b => !(b.node === node && b.tId == currentTeamId));
            if (initialLength !== textBoxes.length) {
                const responseData = { type, fnc, node, tId: currentTeamId };
                try {
                    await queryPromise('DELETE FROM Text WHERE node = ? AND pId = ? AND tId = ?', [node, 1, currentTeamId]);
                    await queryPromise('DELETE FROM ProjectInfo WHERE node = ? AND pId = ? AND tId = ?', [node, 1, currentTeamId]);
                } catch (error) {
                    console.error('텍스트 박스 삭제 실패:', error);
                }
                io.to(String(currentTeamId)).emit('removeTextBox', responseData);
            }
        }
    });

    socket.on('disconnect', () => {
        const currentTeamId = getTeamId();
        if (currentTeamId) socket.leave(String(currentTeamId));
    });
};
