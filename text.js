const { queryPromise } = require('./dbConnector');
const { v4: uuidv4 } = require('uuid');

let textBoxes = [];

async function initializeTextBoxes() {
  // DB에서 텍스트 박스 초기화
  const textResults = await queryPromise('SELECT * FROM Text', []);
  const textBoxesData = await Promise.all(textResults.map(async (row) => {
    const infoResults = await queryPromise(
      'SELECT locate, scale FROM ProjectInfo WHERE node = ? AND tId = ?',
      [row.node, row.tId]
    );
    let locate = { x: 0, y: 0 };
    let scale = { width: 180, height: 100 };
    if (infoResults.length > 0) {
      if (infoResults[0].locate) locate = JSON.parse(infoResults[0].locate);
      if (infoResults[0].scale) scale = JSON.parse(infoResults[0].scale);
    }
    return {
      node: row.node,
      tId: row.tId,
      uId: row.uId,
      x: locate.x,
      y: locate.y,
      width: scale.width,
      height: scale.height,
      font: row.font || 'Arial',
      color: row.color || '#000000',
      size: row.fontSize || 14,
      text: row.content || ''
    };
  }));
  textBoxes = textBoxesData;
  return textBoxes;
}

function getTeamTextBoxes(teamId) {
  return textBoxes.filter(box => box.tId == teamId);
}

async function addTextBox(data, teamId, userId) {
  const newNode = uuidv4();
  const width = data.cScale?.width || 180;
  const height = data.cScale?.height || 100;
  const x = data.cLocate?.x || 0;
  const y = data.cLocate?.y || 0;
  const box = {
    node: newNode,
    tId: teamId,
    uId: userId,
    x, y, width, height,
    font: data.cFont || 'Arial',
    color: data.cColor || '#000000',
    size: data.cSize || 14,
    text: data.cContent || ''
  };
  textBoxes.push(box);
  await queryPromise(
    'INSERT INTO Text (node, pId, tId, uId, content, font, color, fontSize) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [newNode, 1, teamId, userId, box.text, box.font, box.color, box.size]
  );
  await queryPromise(
    'INSERT INTO ProjectInfo (node, pId, tId, dType, locate, scale) VALUES (?, ?, ?, ?, ?, ?)',
    [newNode, 1, teamId, 'text', JSON.stringify({ x, y }), JSON.stringify({ width, height })]
  );
  return {
    type: data.type || 'text',
    fnc: 'new',
    node: newNode,
    tId: teamId,
    cLocate: { x, y },
    cScale: { width, height },
    cFont: box.font,
    cColor: box.color,
    cSize: box.size,
    cContent: box.text
  };
}

async function updateTextBox(data, teamId) {
  const box = textBoxes.find(b => b.node === data.node && b.tId == teamId);
  if (!box) return null;
  if (data.cFont !== undefined) box.font = data.cFont;
  if (data.cColor !== undefined) box.color = data.cColor;
  if (data.cSize !== undefined) box.size = data.cSize;
  if (data.cContent !== undefined) box.text = data.cContent;
  await queryPromise(
    'UPDATE Text SET content = ?, font = ?, color = ?, fontSize = ? WHERE node = ? AND tId = ?',
    [box.text, box.font, box.color, box.size, data.node, teamId]
  );
  return {
    type: data.type || 'text',
    fnc: 'update',
    node: box.node,
    cFont: box.font,
    cColor: box.color,
    cSize: box.size,
    cContent: box.text,
    tId: teamId
  };
}

async function moveTextBox(data, teamId, userId) {
  const box = textBoxes.find(b => b.node === data.node && b.tId == teamId);
  if (!box) return null;
  if (data.cLocate) {
    box.x = Number(data.cLocate.x);
    box.y = Number(data.cLocate.y);
  }
  if (data.cScale) {
    if (data.cScale.width !== undefined) box.width = data.cScale.width;
    if (data.cScale.height !== undefined) box.height = data.cScale.height;
  }
  await queryPromise(
    'UPDATE ProjectInfo SET locate = ?, scale = ? WHERE node = ? AND tId = ?',
    [JSON.stringify({ x: box.x, y: box.y }), JSON.stringify({ width: box.width, height: box.height }), box.node, teamId]
  );
  return {
    type: data.type || 'text',
    fnc: 'move',
    node: box.node,
    tId: teamId,
    uId: userId,
    cLocate: { x: box.x, y: box.y },
    cScale: { width: box.width, height: box.height }
  };
}

async function deleteTextBox(data, teamId) {
  const initialLength = textBoxes.length;
  textBoxes = textBoxes.filter(b => !(b.node === data.node && b.tId == teamId));
  if (initialLength === textBoxes.length) return null;
  await queryPromise('DELETE FROM Text WHERE node = ? AND tId = ?', [data.node, teamId]);
  await queryPromise('DELETE FROM ProjectInfo WHERE node = ? AND tId = ?', [data.node, teamId]);
  return {
    type: data.type || 'text',
    fnc: 'delete',
    node: data.node,
    tId: teamId
  };
}

module.exports = {
  initializeTextBoxes,
  getTeamTextBoxes,
  addTextBox,
  updateTextBox,
  moveTextBox,
  deleteTextBox
};
