const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(express.static(__dirname));


let textBoxes = [];
let nextId = 1;

io.on('connection', (socket) => {
  console.log(`새 클라이언트 연결: ${socket.id}`);
  // 초기 데이터 전송
  socket.emit('initialize', textBoxes);

  // 새 텍스트 박스 생성
  socket.on('newTextBox', (data) => {
    const box = {
      id: nextId++,
      x: data.x,
      y: data.y,
      width: 120,
      height: 40,
      text: '',
    };
    textBoxes.push(box);
    io.emit('addTextBox', box);
    console.log('생성된 박스:', box);
  });

  // 텍스트 박스 내용 수정
  socket.on('editTextBox', (data) => {
    const box = textBoxes.find(b => b.id === data.id);
    if (box) {
      box.text = data.text;
      io.emit('updateTextBox', box);
    }
  });

  // 텍스트 박스 이동/크기조절
  socket.on('moveResizeTextBox', (data) => {
    console.log('이동/크기조절 요청:', data);
    
    const box = textBoxes.find(b => b.id === data.id);
    if (!box) {
      console.error('존재하지 않는 박스 ID:', data.id);
      return;
    }
    
    // 숫자 타입 강제 변환
    box.x = Number(data.x);
    box.y = Number(data.y);
    box.width = Number(data.width);
    box.height = Number(data.height);
    
    io.emit('updateTextBox', box);
  });

  // 텍스트 박스 삭제 (에러 처리 추가)
  socket.on('deleteTextBox', (id) => {
    console.log('삭제 요청 ID:', id);
    
    const initialLength = textBoxes.length;
    textBoxes = textBoxes.filter(b => b.id !== id);
    
    if (initialLength === textBoxes.length) {
      console.error('삭제 실패: 존재하지 않는 ID');
      return;
    }
    
    io.emit('removeTextBox', id);
  });

  // 클라이언트 연결 해제 로그
  socket.on('disconnect', () => {
    console.log(`클라이언트 연결 해제: ${socket.id}`);
  });
});

server.listen(3000, () => {
  console.log('서버가 3000번 포트에서 실행 중입니다.');
});
