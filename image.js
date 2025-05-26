const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { queryPromise } = require('./dbConnector');

//multer가 파일을 저장할 때 이 경로를 사용
const uploadDir = path.join(__dirname, './public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});
const upload = multer({ storage: storage, limits: { fileSize: 20 * 1024 * 1024 } });

async function handleImageUpload(req, res, io) {
  if (!req.file) return res.status(400).send('이미지 없음');
  const { tId, pId, uId } = req.body;
  const node = uuidv4();
  const fileName = req.file.originalname;
  const filePath = `/uploads/${req.file.filename}`;
  const mimeType = req.file.mimetype;

  try {
    await queryPromise(
      'INSERT INTO Image (node, pId, tId, uId, fileName, filePath, mimeType) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [node, pId, tId, uId, fileName, filePath, mimeType]
    );
    io.to(String(tId)).emit('addImage', {
      node, pId, tId, uId, fileName, filePath, mimeType
    });
    res.json({ success: true, node, filePath });
  } catch (err) {
    console.error(err);
    res.status(500).send('DB 저장 실패');
  }
}

module.exports = { upload, handleImageUpload };
