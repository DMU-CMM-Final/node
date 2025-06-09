const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { db, queryPromise } = require('./dbConnector');
const { upload, handleImageUpload, imageHandlers } = require('./image');
const textHandlers = require('./text');
const voteHandlers = require('./vote');

const cors = require('cors');
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});
app.use(cors());

const userIdToSocketId = {};
const socketIdToUserId = {};

let textBoxes = [];
let votes = [];
let images = [];

// 이미지 업로드 API
app.post('/api/image/upload', upload.single('image'), (req, res) => {
handleImageUpload(req, res, io, images);
});



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
    console.log('DB에서 불러온 이미지 정보:', imageItems);


    // console.log('이미지 초기화 결과:', images);
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


      // 팀(방) 입장
  socket.on('join-room', ({ teamId, userId }) => {
    console.log(`User ${userId} joining room ${teamId}`);
    
    userIdToSocketId[userId] = socket.id;
    socketIdToUserId[socket.id] = userId;
    socket.join(teamId);
    
    // 현재 사용자 정보도 업데이트
    if (!currentUserId) currentUserId = userId;
    if (!currentTeamId) currentTeamId = teamId;
    
    socket.to(teamId).emit('user-joined', { userId, socketId: socket.id });
    console.log(`User ${userId} joined team ${teamId}, socket: ${socket.id}`);
  });

  // offer 전달
  socket.on('webrtc-offer', ({ teamId, to, from, offer }) => {
    console.log(`Offer from ${from} to ${to}`);
    const targetSocketId = userIdToSocketId[to];
    if (targetSocketId) {
      io.to(targetSocketId).emit('webrtc-offer', { 
        from: from, 
        offer: offer 
      });
      console.log(`Offer forwarded to ${to} (${targetSocketId})`);
    } else {
      console.log(`Target user ${to} not found`);
    }
  });

  // answer 전달
  socket.on('webrtc-answer', ({ teamId, to, from, answer }) => {
    console.log(`Answer from ${from} to ${to}`);
    const targetSocketId = userIdToSocketId[to];
    if (targetSocketId) {
      io.to(targetSocketId).emit('webrtc-answer', { 
        from: from, 
        answer: answer 
      });
      console.log(`Answer forwarded to ${to} (${targetSocketId})`);
    } else {
      console.log(`Target user ${to} not found`);
    }
  });

  // ICE candidate 전달
  socket.on('webrtc-candidate', ({ teamId, to, from, candidate }) => {
    console.log(`ICE candidate from ${from} to ${to}`);
    const targetSocketId = userIdToSocketId[to];
    if (targetSocketId) {
      io.to(targetSocketId).emit('webrtc-candidate', { 
        from: from, 
        candidate: candidate 
      });
      console.log(`ICE candidate forwarded to ${to} (${targetSocketId})`);
    } else {
      console.log(`Target user ${to} not found`);
    }
  });
  
  socket.on('start-call', ({ teamId }) => {
    console.log(`Start call in team ${teamId} by ${socketIdToUserId[socket.id]}`);
    
    const room = io.sockets.adapter.rooms.get(teamId);
    if (!room) {
      console.log(`Room ${teamId} not found`);
      return;
    }
    
    const clients = Array.from(room);
    console.log(`Clients in room ${teamId}:`, clients);
    
    clients.forEach(clientId => {
      if (clientId !== socket.id) {
        const targetUserId = socketIdToUserId[clientId];
        console.log(`Sending call-user to ${targetUserId} (${clientId})`);
        io.to(clientId).emit('call-user', { 
          from: socketIdToUserId[socket.id]
        });
      }
    });
  });

  socket.on('disconnect', () => {
    const userId = socketIdToUserId[socket.id];
    console.log(`User ${userId} disconnected (${socket.id})`);
    
    if (userId) {
      delete userIdToSocketId[userId];
      delete socketIdToUserId[socket.id];
    }
    
    if (currentTeamId) {
      socket.leave(String(currentTeamId));
    }
  });
  // 유저 퇴장 시
  socket.on('disconnecting', () => {
    const rooms = Array.from(socket.rooms).filter(r => r !== socket.id);
    const userId = socketIdToUserId[socket.id];
    
    rooms.forEach(teamId => {
      socket.to(teamId).emit('user-left', { 
        socketId: socket.id, 
        userId: userId 
      });
    });
  });

      socket.on('signal', ({ id, data }) => {
            io.to(id).emit('signal', { from: socket.id, data });
      });

      socket.on('joinTeam', async ({ uId, tId, pId }) => {
        currentTeamId = tId;
        currentProjectId = pId;
        currentUserId = uId;
        
        // 사용자 매핑 추가
        userIdToSocketId[uId] = socket.id;
        socketIdToUserId[socket.id] = uId;
        
        socket.join(String(currentTeamId));

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