const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { queryPromise } = require('./dbConnector');

//multer가 파일을 저장할 때 이 경로를 사용
const uploadDir = path.join(__dirname, './public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });// uploads 폴더가 없으면 생성

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});//파일 저장 위치, 파일명 규칙임 uuid+확장자

// multer 인스턴스 생성 (20MB 제한)
const upload = multer({ storage: storage, limits: { fileSize: 20 * 1024 * 1024 } });

async function handleImageUpload(req, res, io) {
  if (!req.file) return res.status(400).send('이미지 없음');
  const cLocate = req.body.cLocate ? JSON.parse(req.body.cLocate) : {};
  const cScale = req.body.cScale ? JSON.parse(req.body.cScale) : {};
  const { tId, pId, uId } = req.body;
  const node = uuidv4();
  const fileName = req.file.originalname;
  const filePath = `/uploads/${req.file.filename}`;
  const mimeType = req.file.mimetype;
  const x = cLocate.x || 0;
  const y = cLocate.y || 0;
  const width = cScale.width || 200;
  const height = cScale.height || 200;

    try {
    await queryPromise(
      'INSERT INTO Image (node, pId, tId, uId, fileName, filePath, mimeType) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [node, pId, tId, uId, fileName, filePath, mimeType]
    );
    await queryPromise(
      'INSERT INTO ProjectInfo (node, pId, tId, dType, locate, scale) VALUES (?, ?, ?, ?, ?, ?)',
      [node, pId, tId, 'image', JSON.stringify({ x, y }), JSON.stringify({ width, height })]
    );
    io.to(String(tId)).emit('addImage', {
      node, pId, tId, uId, fileName, filePath, mimeType, cLocate: { x, y }, cScale: { width, height }
    });
    res.json({ success: true, node, filePath, cLocate: { x, y }, cScale: { width, height } });
  } catch (err) {
    console.error(err);
    res.status(500).send('DB 저장 실패');
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

    // 이동
    if (fnc === 'move') {
      try {
        await context.queryPromise(
          'UPDATE ProjectInfo SET locate = ? WHERE node = ? AND pId = ? AND tId = ?',
          [JSON.stringify(cLocate), node, currentProjectId, currentTeamId]
        );
        io.to(String(currentTeamId)).emit('moveImage', {
          type, fnc, node, tId: currentTeamId, pId: currentProjectId, cLocate
        });
      } catch (error) {
        console.error('이미지 이동 실패:', error);
      }
    }
    // 크기 조정
    else if (fnc === 'resize') {
      try {
        await context.queryPromise(
          'UPDATE ProjectInfo SET scale = ? WHERE node = ? AND pId = ? AND tId = ?',
          [JSON.stringify(cScale), node, currentProjectId, currentTeamId]
        );
        io.to(String(currentTeamId)).emit('resizeImage', {
          type, fnc, node, tId: currentTeamId, pId: currentProjectId, cScale
        });
      } catch (error) {
        console.error('이미지 크기 조정 실패:', error);
      }
    }
    // 삭제
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
        // 파일 삭제
        const img = images.find(img => img.node === node && img.pId == currentProjectId && img.tId == currentTeamId);
        if (img) {
          const filePath = path.join(uploadDir, path.basename(img.filePath));
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        setImages(images.filter(img => !(img.node === node && img.pId == currentProjectId && img.tId == currentTeamId)));
        io.to(String(currentTeamId)).emit('deleteImage', {
          type, fnc, node, tId: currentTeamId, pId: currentProjectId
        });
      } catch (error) {
        console.error('이미지 삭제 실패:', error);
      }
    }
  });
}

module.exports = { upload, handleImageUpload, imageHandlers };