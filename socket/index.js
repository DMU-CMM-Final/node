const { v4: uuidv4 } = require('uuid');
const textBoxHandler = require('./textBox.js');
const voteHandler = require('./vote');
const { queryPromise } = require('../dbConnector.js');

let textBoxes = [];
let votes = [];

async function initializeTextBoxes() { /* ...생략... */ }
async function initializeVotes() { /* ...생략... */ }

module.exports = (io) => {
    // 초기화
    initializeTextBoxes().then(() => initializeVotes().then(() => {
        io.on('connection', (socket) => {
            let currentTeamId = null;
            let currentUserId = null;

            // 팀 입장
            socket.on('joinTeam', async ({ uId }) => {
                currentUserId = uId;
                const teamRows = await queryPromise('SELECT tId FROM TeamMem WHERE uId = ?', [uId]);
                if (!teamRows.length) {
                    socket.emit('error', { message: '팀이 없습니다.' });
                    return;
                }
                currentTeamId = teamRows[0].tId;
                socket.join(String(currentTeamId));
                // 팀별 데이터만 전송
                const teamTextBoxes = textBoxes.filter(box => box.tId == currentTeamId);
                socket.emit('initialize', teamTextBoxes);
                const teamVotes = votes.filter(vote => vote.tId == currentTeamId);
                socket.emit('initializeVotes', teamVotes);
            });

            // 각 기능별 핸들러 분리
            textBoxHandler(io, socket, { textBoxes, queryPromise, uuidv4, currentTeamId });
            voteHandler(io, socket, { votes, queryPromise, uuidv4, currentTeamId });

            socket.on('disconnect', () => {
                if (currentTeamId) socket.leave(String(currentTeamId));
            });
        });
    }));
};
