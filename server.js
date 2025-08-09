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
  cors: { origin: '*', methods: ['GET', 'POST'] },
  //path: '/node/socket.io'
  
});

app.use(cors());

// --- 기존 코드 유지 ---
const insertLog = require('./logger');
app.post('/node/api/image/upload', upload.single('image'), (req, res) => {
  handleImageUpload(req, res, io, images);
});
app.get('/node/api/image/:node/:pId/:tId', async (req, res) => {
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
// ✅ [수정] 사용자 및 팀 관리를 위한 단일 데이터 구조
// { teamId: [ { userId, socketId }, ... ] }
let teams = {};

// DB 데이터 메모리 로드 (기존 로직)
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
    console.log('DB에서 불러온 이미지 정보:', imageItems);


    // console.log('이미지 초기화 결과:', images);
  } catch (error) {
    console.error('이미지 초기화 실패:', error);
  }
}



async function initializeData() {
    // ... 기존 initializeTextBoxes, initializeVotes, initializeImages 함수 내용 ...
    // 이 함수들을 호출하여 데이터를 메모리에 로드합니다.
    await initializeTextBoxes();
    await initializeVotes();
    await initializeImages();
}

initializeData().then(() => {
    io.on('connection', (socket) => {
        console.log(`User connected: ${socket.id}`);
        let currentUserId = null;
        let currentTeamId = null;
        

        // ✅ [수정] 방 입장 로직을 'join-room'으로 통일하고 안정화
    socket.on('join-room', async ({ tId: teamId, uId: userId }) => {
        if (!teamId || !userId) return;

        currentTeamId = teamId;
        currentUserId = userId;
        socket.join(teamId);

        if (!teams[teamId]) {
            teams[teamId] = { users: [] };
        }
        
        const otherUsers = teams[teamId].users.map(user => user.userId);
        socket.emit('existing-users', { users: otherUsers });
        
        const userIndex = teams[teamId].users.findIndex(user => user.userId === userId);
        if (userIndex > -1) {
            teams[teamId].users[userIndex].socketId = socket.id;
        } else {
            teams[teamId].users.push({ userId, socketId: socket.id });
        }
        
        socket.to(teamId).emit('user-joined', { userId });

        try {
          await insertLog({
            node: '',      
            tId: currentTeamId,
            uId: currentUserId,
            action: 'join-team'
          }, queryPromise);
        } catch (error) {
          console.error('로그 저장 실패:', error);
        }

        // 초기 객체 데이터 전송
        const filteredTexts = textBoxes.filter(t => t.tId == teamId);
        const filteredVotes = votes.filter(v => v.tId == teamId);
        const filteredImages = images.filter(img => img.tId == teamId);
        socket.emit('init', {
            texts: filteredTexts,
            votes: filteredVotes,
            images: filteredImages,
        });
        
        console.log(`사용자 ${userId}가 팀 ${teamId}에 참여했습니다.`);
    });

    // ✅ [수정] WebRTC 시그널링 중계 로직 (안정화)
    const handleSignaling = (eventName) => {
    socket.on(eventName, async (payload) => {
        if (!payload.teamId || !teams[payload.teamId]) return;
        const toUser = teams[payload.teamId].users.find(user => user.userId === payload.to);

        // 로그 기록 추가
        try {
            await insertLog({
                node: '', // WebRTC 연결 시 고유 노드가 없을 수 있어 빈값 사용
                tId: payload.teamId,
                uId: payload.from, // 발신자 ID
                action: eventName, // 이벤트명 그대로 기록 (ex: 'webrtc-offer')
            }, queryPromise);
        } catch (err) {
            console.error('WebRTC 로그 저장 실패:', err);
        }

        if (toUser) {
            io.to(toUser.socketId).emit(eventName, payload);
        }
    });
};

    handleSignaling('webrtc-offer');
    handleSignaling('webrtc-answer');
    handleSignaling('webrtc-candidate');

    // ✅ [수정] context를 통해 핸들러 모듈 호출 (안정화)
    const context = {
        getCurrentTeamId: () => currentTeamId,
        getCurrentProjectId: () => "1", // 임시 pId
        getCurrentUserId: () => currentUserId,
        textBoxesRef: () => textBoxes,
        setTextBoxes: (newBoxes) => { textBoxes = newBoxes; },
        votesRef: () => votes,
        setVotes: (newVotes) => { votes = newVotes; },
        imagesRef: () => images,
        setImages: (newImages) => { images = newImages; },
        queryPromise,
        teams
    };
    textHandlers(io, socket, context);
    voteHandlers(io, socket, context);
    imageHandlers(io, socket, context);


     // ✅ [수정] 접속 종료 로직
        socket.on('disconnect', () => {
            console.log(`User disconnected: ${socket.id}`);
            if (currentTeamId && currentUserId) {
                // 팀에서 사용자 제거
                if (teams[currentTeamId]) {
                    teams[currentTeamId].users = teams[currentTeamId].users.filter(user => user.userId !== currentUserId);
                    if (teams[currentTeamId].users.length === 0) {
                        delete teams[currentTeamId];
                    }
                }

                // 다른 사용자들에게 퇴장 알림
                socket.to(currentTeamId).emit('user-left', { userId: currentUserId });
                console.log(`User ${currentUserId} left team ${currentTeamId}`);
            }
        });

    });
});

server.listen(3000, () => {
    console.log('서버가 3000번 포트에서 실행 중입니다.');
});