//const path = require('path');
const multer = require('multer');
//const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { queryPromise } = require('./dbConnector');

// 파일 시스템 저장은 필요 없으므로, multer 메모리 스토리지 사용
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

async function handleImageUpload(req, res, io) {
  if (!req.file) return res.status(400).send('이미지 없음');
  const cLocate = req.body.cLocate ? JSON.parse(req.body.cLocate) : {};
  const cScale = req.body.cScale ? JSON.parse(req.body.cScale) : {};
  const { tId, pId, uId } = req.body;
  const node = uuidv4();
  const fileName = req.file.originalname;
  const imageData = req.file.buffer; // 이미지 바이너리 데이터
  const mimeType = req.file.mimetype;
  const x = cLocate.x || 0;
  const y = cLocate.y || 0;
  const width = cScale.width || 200;
  const height = cScale.height || 200;

  try {
    await queryPromise(
      'INSERT INTO Image (node, pId, tId, uId, fileName, imageData, mimeType) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [node, pId, tId, uId, fileName, imageData, mimeType]
    );
    await queryPromise(
      'INSERT INTO ProjectInfo (node, pId, tId, dType, locate, scale) VALUES (?, ?, ?, ?, ?, ?)',
      [node, pId, tId, 'image', JSON.stringify({ x, y }), JSON.stringify({ width, height })]
    );
    io.to(String(tId)).emit('addImage', {
      node, pId, tId, uId, fileName, mimeType, cLocate: { x, y }, cScale: { width, height }
    });
    res.json({ success: true, node, mimeType, cLocate: { x, y }, cScale: { width, height } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'DB 저장 실패' });
  }
}

function imageHandlers(io, socket, context) {
  socket.on('imageEvent', async (data) => {
    const currentTeamId = context.getCurrentTeamId();
    const currentProjectId = context.getCurrentProjectId();
    const images = context.imagesRef();
    const setImages = context.setImages;
    if (!currentTeamId || !currentProjectId) return;

    const { fnc, node, cLocate, cScale, fileName, type = 'image' } = data;

    if (fnc === 'move') {
      try {
        await context.queryPromise(
          'UPDATE ProjectInfo SET locate = ?, scale = ? WHERE node = ? AND pId = ? AND tId = ?',
          [
            JSON.stringify(cLocate || {}),
            JSON.stringify(cScale || {}),
            node,
            currentProjectId,
            currentTeamId
          ]
        );
        socket.to(String(currentTeamId)).emit('moveImage', {
          type, fnc, node,
          tId: currentTeamId,
          pId: currentProjectId,
          cLocate,
          cScale
        });
      } catch (error) {
        console.error('이미지 이동/크기조정 실패:', error);
      }
    }
    else if (fnc === 'delete') {
      try {
        await context.queryPromise(
          'DELETE FROM Image WHERE node = ? AND pId = ? AND tId = ?',
          [node, currentProjectId, currentTeamId]
        );
        await context.queryPromise(
          'DELETE FROM ProjectInfo WHERE node = ? AND pId = ? AND tId = ?',
          [node, currentProjectId, currentTeamId]
        );
        setImages(images.filter(img => !(img.node === node && img.pId == currentProjectId && img.tId == currentTeamId)));
        socket.to(String(currentTeamId)).emit('removeImage', {
          type, fnc, node,
          tId: currentTeamId,
          pId: currentProjectId
        });
      } catch (error) {
        console.error('이미지 삭제 실패:', error);
      }
    }
  });
}

module.exports = { upload, handleImageUpload, imageHandlers };
