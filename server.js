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
  path: '/node/socket.io'
  
});

app.use(cors());

//.env파일 읽기
require('dotenv').config();

const { summarizeMeeting } = require('./aiService');


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



  } catch (error) {
    console.error('이미지 초기화 실패:', error);
  }
}



async function initializeData() {
    await initializeTextBoxes();
    await initializeVotes();
    await initializeImages();
}

initializeData().then(() => {
    io.on('connection', (socket) => {

        let currentUserId = null;
        let currentTeamId = null;
        let currentProjectId = null;
        

        
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

            let currentUsers = [];

            try {
                const projects = await queryPromise(
                    'SELECT pId, pName, createDate FROM TeamProject WHERE tId = ?',
                    [teamId]
                );

                // 현재 접속한 유저 목록
                currentUsers = teams[teamId].users.map(u => u.userId);

                socket.emit('room-info', {
                    users: currentUsers,
                    projects
                });
            } catch (err) {
                console.error('프로젝트 목록 불러오기 실패:', err);
            }

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

        });

        socket.on('join-project', async ({ pId }) => {
          if (!currentTeamId || !pId) {
            socket.emit('error', { message: '팀 또는 프로젝트 ID가 없습니다.' });
            return;
          }

          currentProjectId = pId;

          //프로젝트 데이터 필터링
          const filteredTexts = textBoxes.filter(t => t.tId == currentTeamId && t.pId == currentProjectId);
          const filteredVotes = votes.filter(v => v.tId == currentTeamId && v.pId == currentProjectId);
          const filteredImages = images.filter(img => img.tId == currentTeamId && img.pId == currentProjectId);

          socket.emit('project-init', { 
            pId: currentProjectId, 
            texts: filteredTexts, 
            votes: filteredVotes, 
            images: filteredImages 
          });
        });

        // 프로젝트 생성
        socket.on('project-create', async ({ name }) => {
        if (!currentTeamId || !name) {
            console.warn('currentTeamId or name missing');
            return;
        }
        try {
            const result = await queryPromise(
                'INSERT INTO TeamProject (tId, pName, createDate) VALUES (?, ?, CURDATE())',
                [currentTeamId, name]
            );
            const newProject = { pId: result.insertId, pName: name, createDate: new Date().toISOString().split('T')[0] };
            
            io.to(currentTeamId).emit('project-added', newProject);
            
          } catch (err) {
                console.error('프로젝트 생성 실패:', err);
            }
        });


        // 프로젝트 이름 변경
        socket.on('project-rename', async ({ pId, newName }) => {
            if (!currentTeamId || !pId || !newName) return;
            try {
                await queryPromise(
                    'UPDATE TeamProject SET pName = ? WHERE pId = ? AND tId = ?',
                    [newName, pId, currentTeamId]
                );
                io.to(currentTeamId).emit('project-renamed', { pId, newName });
            } catch (err) {
                console.error('프로젝트 이름 변경 실패:', err);
            }
        });

        // 프로젝트 삭제
        socket.on('project-delete', async ({ pId }) => {
            if (!currentTeamId || !pId) return;
            try {
                await queryPromise('DELETE FROM TeamProject WHERE pId = ? AND tId = ?', [pId, currentTeamId]);
                io.to(currentTeamId).emit('project-deleted', { pId });
            } catch (err) {
                console.error('프로젝트 삭제 실패:', err);
            }
        });



    
    // 🔹 클라이언트에서 회의록 요약 요청
      socket.on('summarize-request', async () => {
      try {
        if (!currentTeamId || !currentProjectId) {
          socket.emit('summarize-result', { summary: "선택된 팀 또는 프로젝트가 없습니다." });
          return;
        }

          const meetingNotes = [
          ...textBoxes.filter(t => t.tId == currentTeamId && t.pId == currentProjectId).map(t => t.text),
          ...votes.filter(v => v.tId == currentTeamId && v.pId == currentProjectId)
            .map(v => `투표: ${v.title} (${v.list.map(i => i.content).join(', ')})`),
          ...images.filter(img => img.tId == currentTeamId && img.pId == currentProjectId)
            .map(img => `이미지 파일: ${img.fileName || '이미지'}`)
        ].join('\n');

        if (!meetingNotes.trim()) {
          socket.emit('summarize-result', { summary: "요약할 회의록이 없습니다." });
          return;
        }

        const summary = await summarizeMeeting(meetingNotes);
        io.to(currentTeamId).emit('summarize-result', { summary });
      } catch (err) {
        console.error(err);
        socket.emit('summarize-result', { summary: "요약 실패" });
      }
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
        getCurrentProjectId: () => currentProjectId,
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
            }
        });

    });
});

server.listen(3000, () => {
    console.log('서버가 3000번 포트에서 실행 중입니다.');
});