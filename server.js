const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { db, queryPromise } = require('./dbConnector');
const { upload, handleImageUpload } = require('./image');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// 이미지만 외부에 제공
//클라이언트(브라우저 등)가 이미지를 접근할 수 있도록 정적 파일 제공
app.use('/uploads', express.static(path.join(__dirname, './public', 'uploads')));

// 이미지 업로드 API
app.post('/api/image/upload', upload.single('image'), (req, res) => {
  handleImageUpload(req, res, io);
});

// 메모리 데이터
let textBoxes = [];
let votes = [];

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

const textHandlers = require('./text');
const voteHandlers = require('./vote');

initializeTextBoxes().then(() => initializeVotes().then(() => {
  io.on('connection', (socket) => {
    let currentTeamId = null;
    let currentProjectId = null;
    let currentUserId = null;

    socket.on('joinTeam', async ({ uId, tId, pId }) => {
      currentTeamId = tId;
      currentProjectId = pId;
      currentUserId = uId;
      socket.join(String(currentTeamId));
      const filteredTexts = textBoxes.filter(t => t.tId == currentTeamId && t.pId == currentProjectId);
      const filteredVotes = votes.filter(v => v.tId == currentTeamId && v.pId == currentProjectId);
      socket.emit('init', { texts: filteredTexts, votes: filteredVotes });
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

    socket.on('disconnect', () => {
      if (currentTeamId) socket.leave(String(currentTeamId));
    });
  });
}));

server.listen(3000, () => {
  console.log('서버가 3000번 포트에서 실행 중입니다.');
});
