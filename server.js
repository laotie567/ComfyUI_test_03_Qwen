const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const rateLimit = require('express-rate-limit');

const app = express();
const port = 3000;

// 读取ComfyUI工作流JSON文件
const comfyuiWorkflows = JSON.parse(fs.readFileSync('comfyui_workflows.json', 'utf8'));

// 设置文件存储
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: function (req, file, cb) {
    const filetypes = /jpeg|jpg|png/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Error: Images Only!'));
    }
  }
});

// 创建uploads文件夹
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// 设置速率限制
const limiter = rateLimit({
  windowMs: 120 * 1000, // 120 seconds
  max: 10, // limit each IP to 10 requests per windowMs
  message: 'Too many requests, please try again later.'
});

app.use('/api/process-image', limiter);

// 处理文件上传和ComfyUI调用
app.post('/api/process-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const functionType = req.body.functionType;
    const processingParams = req.body.processingParams;

    if (!functionType) {
      return res.status(400).json({ error: 'Function type is required' });
    }

    // 获取ComfyUI工作流配置
    const workflow = comfyuiWorkflows[functionType];
    if (!workflow) {
      return res.status(400).json({ error: 'Invalid function type' });
    }

    // 合并处理参数
    const params = { ...workflow.params, ...processingParams };

    // 上传图片到RunningHub并获取图片URL
    const imageUrl = await uploadImageToRunningHub(filePath);

    // 创建任务
    const taskId = await createTaskOnRunningHub(workflow.function, params, imageUrl);

    // 查询任务结果
    const resultUrl = await getTaskResultFromRunningHub(taskId);

    // 返回处理结果
    res.status(200).json({
      status: 'completed',
      resultUrl: resultUrl,
      message: 'Image processed successfully'
    });
  } catch (error) {
    console.error(error);
    if (error.message === 'Error: Images Only!') {
      res.status(400).json({ error: 'Invalid file format', message: error.message });
    } else if (error.message.includes('File too large')) {
      res.status(413).json({ error: 'File size exceeds limit', message: error.message });
    } else {
      res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
  }
});

// 上传图片到RunningHub并获取图片URL
async function uploadImageToRunningHub(filePath) {
  const formData = new FormData();
  formData.append('file', fs.createReadStream(filePath));

  const response = await axios.post('https://www.runninghub.cn/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  });

  if (response.data.code !== 0) {
    throw new Error(response.data.msg);
  }

  return response.data.data.fileUrl;
}

// 创建任务
async function createTaskOnRunningHub(functionType, params, imageUrl) {
  const apiKey = 'YOUR_API_KEY'; // 替换为你的API KEY
  const workflowId = 'YOUR_WORKFLOW_ID'; // 替换为你的workflow ID

  const nodeInfoList = [
    {
      nodeId: 'YOUR_NODE_ID', // 替换为你的node ID
      fieldName: 'image',
      fieldValue: imageUrl
    }
  ];

  const response = await axios.post('https://www.runninghub.cn/task/openapi/create', {
    workflowId: workflowId,
    apiKey: apiKey,
    nodeInfoList: nodeInfoList
  });

  if (response.data.code !== 0) {
    throw new Error(response.data.msg);
  }

  return response.data.data.taskId;
}

// 查询任务结果
async function getTaskResultFromRunningHub(taskId) {
  const apiKey = 'YOUR_API_KEY'; // 替换为你的API KEY

  const response = await axios.post('https://www.runninghub.cn/task/openapi/outputs', {
    taskId: taskId,
    apiKey: apiKey
  });

  if (response.data.code !== 0) {
    throw new Error(response.data.msg);
  }

  return response.data.data[0].fileUrl;
}

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
}); 