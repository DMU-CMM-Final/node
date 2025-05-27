const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { db, queryPromise } = require('./dbConnector');
const { upload, handleImageUpload, imageHandlers } = require('./image');
const textHandlers = require('./text');
const voteHandlers = require('./vote');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// 이미지 업로드 API
app.post('/api/image/upload', upload.single('image'), (req, res) => {
  handleImageUpload(req, res, io);
});

// 메모리 데이터
let textBoxes = [];
let votes = [];
let images = [];

// 데이터 초기화 함수
async function initializeTextBoxes() {
  try {
    const boxes = await queryPromise(
      'SELECT Text.*, ProjectInfo.locate, ProjectInfo.scale FROM Text JOIN ProjectInfo ON Text.node = ProjectInfo.node AND Text.pId = ProjectInfo.pId AND Text.tId = ProjectInfo.tId WHERE ProjectInfo.dType = "text"'
    );
    textBoxes = boxes.map(box => ({
      node: box.node,
      tId: box.tId,
      pId: box.pId,
      uId: box.uId,
      x: JSON.parse(box.locate).x,
      y: JSON.parse(box.locate).y,
      width: JSON.parse(box.scale).width,
      height: JSON.parse(box.scale).height,
      font: box.font,
      color: box.color,
      size: box.fontSize,
      text: box.content
    }));
  } catch (error) {
    console.error('텍스트박스 초기화 실패:', error);
  }
}
async function initializeVotes() {
  try {
    const voteItems = await queryPromise(
      'SELECT Vote.*, ProjectInfo.locate, ProjectInfo.scale FROM Vote JOIN ProjectInfo ON Vote.node = ProjectInfo.node AND Vote.pId = ProjectInfo.pId AND Vote.tId = ProjectInfo.tId WHERE ProjectInfo.dType = "vote"'
    );
    for (const vote of voteItems) {
      const users = await queryPromise(
        'SELECT uId, num FROM VoteUser WHERE node = ? AND pId = ? AND tId = ?',
        [vote.node, vote.pId, vote.tId]
      );
      vote.users = users;
    }
    votes = voteItems.map(vote => ({
      node: vote.node,
      tId: vote.tId,
      pId: vote.pId,
      x: JSON.parse(vote.locate).x,
      y: JSON.parse(vote.locate).y,
      width: JSON.parse(vote.scale).width,
      height: JSON.parse(vote.scale).height,
      title: vote.title,
      list: [
        { num: 1, content: vote.list1, count: vote.list1Num },
        { num: 2, content: vote.list2, count: vote.list2Num },
        { num: 3, content: vote.list3, count: vote.list3Num },
        { num: 4, content: vote.list4, count: vote.list4Num }
      ],
      count: [vote.list1Num, vote.list2Num, vote.list3Num, vote.list4Num],
      users: vote.users || []
    }));
  } catch (error) {
    console.error('투표 초기화 실패:', error);
  }
}

async function initializeImages() {
  try {
    const imageItems = await queryPromise(
      'SELECT Image.node, Image.pId, Image.tId, Image.uId, Image.fileName, Image.mimeType, ProjectInfo.locate, ProjectInfo.scale FROM Image JOIN ProjectInfo ON Image.node = ProjectInfo.node AND Image.pId = ProjectInfo.pId AND Image.tId = ProjectInfo.tId WHERE ProjectInfo.dType = "image"'
    );
    images = imageItems.map(img => ({
      node: img.node,
      tId: img.tId,
      pId: img.pId,
      uId: img.uId,
      fileName: img.fileName,
      mimeType: img.mimeType,
      x: JSON.parse(img.locate).x,
      y: JSON.parse(img.locate).y,
      width: JSON.parse(img.scale).width,
      height: JSON.parse(img.scale).height
    }));
  } catch (error) {
    console.error('이미지 초기화 실패:', error);
  }
}
// 이미지 불러오기
app.get('/api/image/:node/:pId/:tId', async (req, res) => {
  const { node, pId, tId } = req.params;
  try {
    const [image] = await queryPromise(
      'SELECT imageData, mimeType FROM Image WHERE node = ? AND pId = ? AND tId = ?',
      [node, pId, tId]
    );
    if (!image) return res.status(404).send('이미지 없음');
    res.set('Content-Type', image.mimeType);
    res.send(image.imageData);
  } catch (err) {
    console.error(err);
    res.status(500).send('서버 오류');
  }
});


initializeTextBoxes()
  .then(() => initializeVotes())
  .then(() => initializeImages())
  .then(() => {
    io.on('connection', (socket) => {

      let currentTeamId = null;
      let currentProjectId = null;
      let currentUserId = null;

      socket.on('signal', ({ id, data }) => {
            io.to(id).emit('signal', { from: socket.id, data });
      });

      socket.on('joinTeam', async ({ uId, tId, pId }) => {
        currentTeamId = tId;
        currentProjectId = pId;
        currentUserId = uId;
        socket.join(String(currentTeamId));

        //팀,프젝 필터링해서 전송
        const filteredTexts = textBoxes.filter(t => t.tId == currentTeamId && t.pId == currentProjectId);
        const filteredVotes = votes.filter(v => v.tId == currentTeamId && v.pId == currentProjectId);
        const filteredImages = images.filter(img => img.tId == currentTeamId && img.pId == currentProjectId);
        socket.emit('init', {
          texts: filteredTexts,
          votes: filteredVotes,
          images: filteredImages,
          clients: io.sockets.adapter.rooms.get(String(currentTeamId)) || []
        });
        
      });
      socket.on('mouseMove', (data) => {
        if (currentTeamId) { // 같은팀에 속해 있을 때만 전송
          io.to(String(currentTeamId)).emit('mouseMove', { userId: currentUserId, x: data.x, y: data.y });
        }
      });

      textHandlers(io, socket, {
        getCurrentTeamId: () => currentTeamId,
        getCurrentProjectId: () => currentProjectId,
        getCurrentUserId: () => currentUserId,
        textBoxesRef: () => textBoxes,
        setTextBoxes: (boxes) => { textBoxes = boxes; },
        queryPromise
      });

      voteHandlers(io, socket, {
        getCurrentTeamId: () => currentTeamId,
        getCurrentProjectId: () => currentProjectId,
        getCurrentUserId: () => currentUserId,
        votesRef: () => votes,
        setVotes: (v) => { votes = v; },
        queryPromise
      });

      imageHandlers(io, socket, {
        getCurrentTeamId: () => currentTeamId,
        getCurrentProjectId: () => currentProjectId,
        getCurrentUserId: () => currentUserId,
        imagesRef: () => images,
        setImages: (imgs) => { images = imgs; },
        queryPromise
      });

      socket.on('disconnect', () => {
        if (currentTeamId) socket.leave(String(currentTeamId));
      });
    });
  });

server.listen(3000, () => {
  console.log('서버가 3000번 포트에서 실행 중입니다.');
});