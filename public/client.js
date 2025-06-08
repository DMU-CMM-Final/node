const socket = io();
let myInfo = {};
let cursors = {};
let currentTeamId = null;
let currentUserId = null;
let clients = [];
let peerConnections = {}; // 여러 명 지원
let localStream = null;
let isScreenSharing = false;

const canvas = document.getElementById('canvas');
const localVideo = document.getElementById('localVideo');
const videosBox = document.getElementById('videosBox');
const joinBtn = document.getElementById('joinBtn');
const startCallBtn = document.getElementById('startCall');
const screenShareBtn = document.getElementById('screenShare');

joinBtn.onclick = () => {
  const tId = document.getElementById('tId').value;
  const uId = document.getElementById('uId').value;
  if (!tId || !uId) return alert('모두 입력하세요!');
  myInfo = { tId, uId };
  currentTeamId = tId;
  currentUserId = uId;
  socket.emit('joinTeam', myInfo);
};

socket.on('init', (data) => {
  clients = Array.from(data.clients);
  startCallBtn.disabled = false;
  screenShareBtn.disabled = false;
});

socket.on('newPeer', ({ id }) => {
  // 새 참가자가 들어오면, 내가 이미 화상회의 중이면 offer를 보냄
  if (localStream) {
    createPeerFor(id, true);
  }
});

canvas.onmousemove = (e) => {
  if (!currentTeamId) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  socket.emit('mouseMove', { x, y });
};

socket.on('mouseMove', ({ userId, x, y }) => {
  if (!userId) return;
  let cursor = cursors[userId];
  if (!cursor) {
    cursor = document.createElement('div');
    cursor.className = 'cursor';
    cursor.innerHTML = `<span>${userId}</span>`;
    canvas.appendChild(cursor);
    cursors[userId] = cursor;
  }
  cursor.style.left = `${x}px`;
  cursor.style.top = `${y}px`;
});

startCallBtn.onclick = async () => {
  if (localStream) return;
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;
  // 모든 기존 참가자에게 offer 전송
  clients.filter(id => id !== socket.id).forEach(id => {
    createPeerFor(id, true);
  });
};

screenShareBtn.onclick = async () => {
  if (!localStream) return;
  if (!isScreenSharing) {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const screenTrack = screenStream.getVideoTracks()[0];
    Object.values(peerConnections).forEach(pc => {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");
      if (sender) sender.replaceTrack(screenTrack);
    });
    localVideo.srcObject = screenStream;
    screenTrack.onended = () => {
      const localVideoTrack = localStream.getVideoTracks()[0];
      Object.values(peerConnections).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");
        if (sender && localVideoTrack) sender.replaceTrack(localVideoTrack);
      });
      localVideo.srcObject = localStream;
      isScreenSharing = false;
    };
    isScreenSharing = true;
  }
};

function createPeerFor(peerId, isOffer) {
  if (peerConnections[peerId]) return;
  const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  peerConnections[peerId] = pc;
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  // 비디오 태그 생성
  let remoteVideo = document.getElementById('video_' + peerId);
  if (!remoteVideo) {
    remoteVideo = document.createElement('video');
    remoteVideo.id = 'video_' + peerId;
    remoteVideo.autoplay = true;
    remoteVideo.playsInline = true;
    remoteVideo.style.width = '240px';
    remoteVideo.style.background = '#222';
    videosBox.appendChild(remoteVideo);
  }
  pc.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('signal', { id: peerId, data: { candidate: event.candidate } });
    }
  };
  if (isOffer) {
    pc.createOffer().then(offer => {
      pc.setLocalDescription(offer);
      socket.emit('signal', { id: peerId, data: { sdp: offer } });
    });
  }
}

socket.on('signal', async ({ from, data }) => {
  let pc = peerConnections[from];
  if (!pc && localStream) {
    createPeerFor(from, false);
    pc = peerConnections[from];
  }
  if (!pc) return;
  if (data.sdp) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    if (data.sdp.type === "offer") {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('signal', { id: from, data: { sdp: answer } });
    }
  }
  if (data.candidate) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (e) { }
  }
});
