const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 中间件
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// 存储房间和用户信息
const rooms = new Map();
const callSessions = new Map(); // 存储通话会话信息

// 提供静态文件
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.IO 连接处理
io.on('connection', (socket) => {
  console.log('用户连接:', socket.id);

  // 加入房间
  socket.on('join-room', (roomId, userId) => {
    console.log(`用户 ${userId} 加入房间 ${roomId}`);
    
    socket.join(roomId);
    socket.roomId = roomId;
    socket.userId = userId;

    // 初始化房间
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    
    const room = rooms.get(roomId);
    room.add(userId);

    // 通知房间内其他用户
    socket.to(roomId).emit('user-joined', userId);
    
    // 发送当前房间用户列表给新用户
    socket.emit('room-users', Array.from(room));
    
    // 通知房间内所有用户更新用户列表
    io.to(roomId).emit('room-users', Array.from(room));
    
    console.log(`房间 ${roomId} 当前用户:`, Array.from(room));
  });

  // 通话邀请处理
  socket.on('call-invite', (data) => {
    console.log(`${socket.userId} 邀请 ${data.target} 通话`);
    socket.to(data.target).emit('call-invite', {
      caller: socket.userId,
      roomId: socket.roomId
    });
  });

  socket.on('call-response', (data) => {
    console.log(`${socket.userId} 响应通话邀请: ${data.accepted}`);
    socket.to(data.caller).emit('call-response', {
      responder: socket.userId,
      accepted: data.accepted
    });
    
    if (data.accepted) {
      // 如果接受通话，通知房间内其他人开始通话
      io.to(socket.roomId).emit('call-started', {
        participants: [data.caller, socket.userId]
      });
    }
  });

  // WebRTC 信令处理
  socket.on('offer', (data) => {
    console.log('收到offer:', data.target);
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      caller: socket.userId
    });
  });

  socket.on('answer', (data) => {
    console.log('收到answer:', data.target);
    socket.to(data.target).emit('answer', {
      answer: data.answer,
      answerer: socket.userId
    });
  });

  socket.on('ice-candidate', (data) => {
    console.log('收到ICE candidate:', data.target);
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      sender: socket.userId
    });
  });

  // 断开连接处理
  socket.on('disconnect', () => {
    console.log('用户断开连接:', socket.id);
    
    if (socket.roomId && socket.userId) {
      const room = rooms.get(socket.roomId);
      if (room) {
        room.delete(socket.userId);
        if (room.size === 0) {
          rooms.delete(socket.roomId);
        }
        
        // 通知房间内其他用户
        socket.to(socket.roomId).emit('user-left', socket.userId);
        console.log(`用户 ${socket.userId} 离开房间 ${socket.roomId}`);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
});
