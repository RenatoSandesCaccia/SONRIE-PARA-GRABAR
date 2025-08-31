const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

const uploadDir = path.join(__dirname, "upload");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    fs.readdir(uploadDir, (err, files) => {
      if (err) return cb(err);
      const number = files.length + 1;
      const filename = `${number}.webm`;
      cb(null, filename);
    });
  }
});
const upload = multer({ storage });

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});
app.get("/script.js", (req, res) => {
  res.sendFile(path.join(__dirname, "script.js"));
});
app.get("/style.css", (req, res) => {
  res.sendFile(path.join(__dirname, "style.css"));
});
app.get("/face-api.min.js", (req, res) => {
  res.sendFile(path.join(__dirname, "face-api.min.js"));
});

app.use("/models", express.static(path.join(__dirname, "models")));
app.use("/media", express.static(path.join(__dirname, "media")));
app.use("/upload", express.static(path.join(__dirname, "upload")));

app.get("/videos-list", (req, res) => {
  fs.readdir(path.join(__dirname, "upload"), (err, files) => {
    if (err) return res.status(500).json({ error: "Ошибка чтения папки upload" });
    const videoFiles = files.filter(f => f.endsWith(".webm"));
    res.json({ videos: videoFiles });
  });
});

app.post("/upload", upload.single("video"), (req, res) => {
  res.status(200).json({ message: "El video se guardó" });
});

app.get('/favicon.ico', (req, res) => res.status(204).end());

app.listen(PORT, () => {
  console.log(`El servo: http://localhost:${PORT}`);
});
