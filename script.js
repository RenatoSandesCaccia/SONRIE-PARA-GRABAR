const video = document.getElementById("video");
const message = document.getElementById("message");
const recordingStatus = document.getElementById("recordingStatus");
const overlay = document.getElementById("overlay");
const loopPlayer = document.getElementById("loopPlayer");
const uploadBtn = document.getElementById("uploadBtn"); // Si lo usas para subir, déjalo

let mediaRecorder;
let recordedChunks = [];
let recording = false;
let recordStartTime;
let recordingTimer;
let faceNotDetectedSince = null;
let isSmiling = false;
let wasRecordingPaused = false;
let pauseTimeout = null;
let pauseStartTime = null;
let pausedTime = 0;
let fixedAge = null;
let fixedGender = null;
let ageGenderCaptured = false;
let videoCounter = 1;
let lastDetection = null;

let ageSamples = [];
let genderSamples = [];
let lastSampleTime = 0;
const sampleInterval = 300;

let uploadVideos = [];
let currentLoopIndex = 0;
let overlayShown = false;

let recordedBlob = null; // Aquí guardas el video grabado
let cancelUpload = false; // bandera global
let subirPorUsuario = false;

const MAX_RECORD_SECONDS = 20; // <-- Agrega esto al inicio del archivo

// Agrega esta variable global al inicio:
let recordingCooldownUntil = 0;

// Overlay functions

function showOverlay() {
  const overlay = document.getElementById("overlay");
  overlay.style.display = "flex"; 

  fetch("/videos-list")
    .then(res => res.json())
    .then(data => {
      uploadVideos = data.videos;
      if (uploadVideos.length > 0) {
        currentLoopIndex = 0;
        playCurrentVideo();
      } else {
        console.warn("Нет видео в папке upload.");
      }
    })
    .catch(err => {
      console.error("Ошибка при загрузке списка видео:", err);
    });
}

function drawFrame() {
  ctx.drawImage(video, 0, 0, recordCanvas.width, recordCanvas.height);

  // Si NO hay rostro, aplica overlay blanco y negro
  if (faceNotDetectedSince && Date.now() - faceNotDetectedSince > 200) {
    // Convierte a blanco y negro
    let imageData = ctx.getImageData(0, 0, recordCanvas.width, recordCanvas.height);
    let data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      let avg = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      data[i] = avg;     // R
      data[i + 1] = avg; // G
      data[i + 2] = avg; // B
      // data[i + 3] = alpha
    }
    ctx.putImageData(imageData, 0, 0);

    // Overlay de color (opcional, por ejemplo azul translúcido)
    ctx.fillStyle = "rgba(0, 80, 255, 0.15)";
    ctx.fillRect(0, 0, recordCanvas.width, recordCanvas.height);
  }

  // Dibuja el logo arriba a la derecha
  if (logo && logo.complete) {
    const logoWidth = recordCanvas.width * 0.22;
    const aspect = logo.naturalWidth / logo.naturalHeight;
    const logoHeight = logoWidth / aspect;
    ctx.drawImage(
      logo,
      recordCanvas.width - logoWidth - 10,
      10,
      logoWidth,
      logoHeight
    );
  }
  animationFrameId = requestAnimationFrame(drawFrame);
}

function playCurrentVideo() {
  if (uploadVideos.length === 0) return;

  const fileName = uploadVideos[currentLoopIndex];
  const filePath = `/upload/${fileName}`;

  const loopPlayer = document.getElementById("loopPlayer");

  // Очищаем события
  loopPlayer.onended = null;
  loopPlayer.oncanplay = null;

  // Устанавливаем путь и загружаем видео
  loopPlayer.src = filePath;
  loopPlayer.load();

  // Когда видео полностью готово к воспроизведению:
  loopPlayer.oncanplay = () => {
    loopPlayer.play()
      .then(() => {
        console.log(`✅ Воспроизводится: ${fileName}`);
      })
      .catch(err => {
        console.warn("❌ Ошибка воспроизведения:", err);
      });
  };

  // Когда видео завершилось — воспроизводим следующее
  loopPlayer.onended = () => {
    currentLoopIndex = (currentLoopIndex + 1) % uploadVideos.length;
    playCurrentVideo();
  };
}

function hideOverlay() {
  const overlay = document.getElementById("overlay");
  if (!overlay) return;
  overlay.style.display = 'none';
  const loopPlayer = document.getElementById("loopPlayer");
  if (loopPlayer) {
    loopPlayer.pause();
    loopPlayer.src = "";
  }
  overlayShown = false;
  video.style.visibility = "visible";
  if (uploadBtn) uploadBtn.style.display = "block";
}

// Carga modelos y webcam
Promise.all([
  faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
  faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
  faceapi.nets.faceExpressionNet.loadFromUri("/models"),
  faceapi.nets.ageGenderNet.loadFromUri("/models")
]).then(startWebcam);

function startWebcam() {
  navigator.mediaDevices
    .getUserMedia({ video: true, audio: true })
    .then((stream) => {
      video.srcObject = stream;
      startCanvasDrawing(stream);
    })
    .catch((error) => {
      console.error(error);
    });
}

function startCanvasDrawing(stream) {
  const recordCanvas = document.getElementById('recordCanvas');
  const ctx = recordCanvas.getContext('2d');
  const logo = document.getElementById('logoSuperior');
  let animationFrameId;

  function drawFrame() {
    ctx.drawImage(video, 0, 0, recordCanvas.width, recordCanvas.height);
    // Dibuja el logo arriba a la derecha
    if (logo && logo.complete) {
      const logoWidth = recordCanvas.width * 0.22;
      const aspect = logo.naturalWidth / logo.naturalHeight;
      const logoHeight = logoWidth / aspect;
      ctx.drawImage(
        logo,
        recordCanvas.width - logoWidth - 10,
        10,
        logoWidth,
        logoHeight
      );
    }
    animationFrameId = requestAnimationFrame(drawFrame);
  }
  drawFrame();

  // Ahora el stream para grabar será el del canvas
  const canvasStream = recordCanvas.captureStream(30); // 30 FPS
  // Mezcla el audio del stream original
  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length > 0) {
    canvasStream.addTrack(audioTracks[0]);
  }
  setupRecording(canvasStream);
}

function setupRecording(stream) {
  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };
  mediaRecorder.onstop = () => {
    if (!cancelUpload) {
      const blob = new Blob(recordedChunks, { type: "video/webm" });
      const mostrarMensaje = subirPorUsuario; // GUARDA el valor antes de reiniciar
      uploadVideo(blob, mostrarMensaje);
      videoCounter++;
      recordingStatus.textContent = "";
    }
    recordedChunks = [];
    cancelUpload = false; // reinicia bandera
    subirPorUsuario = false; // reinicia bandera
  };
}



video.addEventListener("play", () => {
  const canvas = faceapi.createCanvasFromMedia(video);
  document.body.append(canvas);

  canvas.style.position = "absolute";
  canvas.style.left = video.offsetLeft + "px";
  canvas.style.top = video.offsetTop + "px";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = 1; // Menor que el recordCanvas

  // Asegúrate que el recordCanvas tenga un z-index mayor
  const recordCanvas = document.getElementById('recordCanvas');
  recordCanvas.style.position = "absolute";
  recordCanvas.style.left = video.offsetLeft + "px";
  recordCanvas.style.top = video.offsetTop + "px";
  recordCanvas.style.zIndex = 2; // Por encima del canvas de FaceAPI

  const displaySize = { width: video.width, height: video.height };
  faceapi.matchDimensions(canvas, displaySize);

  setInterval(async () => {
    if (overlayShown) return; // Si el overlay está activo, no hacer nada

    const detections = await faceapi
      .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceExpressions()
      .withAgeAndGender();

    const resized = faceapi.resizeResults(detections, displaySize);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const logo = document.getElementById('logoSuperior');
    if (resized.length > 0) {
      logo.classList.add('visible');
      faceNotDetectedSince = null;
      video.style.visibility = "visible";
      if (uploadBtn) uploadBtn.style.display = "flex";
      // NO ocultes el overlay aquí
    } else {
      if (!faceNotDetectedSince) {
        faceNotDetectedSince = Date.now();
      } else if (Date.now() - faceNotDetectedSince > 2000) {
        message.textContent = "No se detecta rostro.";
        if (uploadBtn) uploadBtn.style.display = "none";
        logo.classList.remove('visible');
        // Aquí se sigue mostrando el canvas con drawFrame (pantalla azul/bn)
      }
    }

    if (resized.length > 0) {
      faceNotDetectedSince = null;
      hideOverlay();
      video.style.visibility = "visible";
      if (uploadBtn) uploadBtn.style.display = "flex";

      resized.forEach((detection) => {
        lastDetection = detection;
        const box = detection.detection.box;
        const currentAge = detection.age;
        const currentGender = detection.gender;
        const ageRounded = currentAge.toFixed(0);

        const displayAge = fixedAge !== null ? fixedAge : ageRounded;
        const displayGender = fixedGender !== null ? fixedGender : currentGender;

        const expressions = detection.expressions;
        const maxEmotion = Object.entries(expressions).reduce((a, b) =>
          a[1] > b[1] ? a : b
        )[0];

        const happyScore = expressions.happy || 0;
        isSmiling = happyScore > 0.6;

        const label = `Edad: ${displayAge}, Género: ${displayGender}, Emoción: ${maxEmotion}`;
        const drawBox = new faceapi.draw.DrawBox(box, { label });
        drawBox.draw(canvas);

        if (recording && !ageGenderCaptured && Date.now() - recordStartTime < 3000) {
          if (ageSamples.length < 3 && Date.now() - lastSampleTime >= sampleInterval) {
            ageSamples.push(currentAge);
            genderSamples.push(currentGender);
            lastSampleTime = Date.now();
          }
        }

        if (recording && !ageGenderCaptured && ageSamples.length === 3) {
          const avgAge = (ageSamples.reduce((a, b) => a + b, 0) / ageSamples.length);
          fixedAge = Math.round(avgAge);
          fixedGender = mode(genderSamples);
          ageGenderCaptured = true;
          ageSamples = [];
          genderSamples = [];
        }

        // BLOQUEO: Si está en cooldown, no permitir grabar ni mostrar mensaje de sonrisa
        if (Date.now() < recordingCooldownUntil) {
          if (!recording) {
            message.textContent = "Espera un momento antes de grabar de nuevo...";
            recordingStatus.style.display = "none";
          }
          return; // Sale del forEach para este frame
        }

        // --- Grabación automática por sonrisa ---
        if (isSmiling && !recording) {
          mediaRecorder.start();
          recordStartTime = Date.now();
          pausedTime = 0;
          updateRecordingTime();
          recordingTimer = setInterval(updateRecordingTime, 1000);
          recording = true;
          message.textContent = "Grabando... Mantén la sonrisa.";
          recordingStatus.style.display = "block";
        } else if (!isSmiling && !recording) {
          message.textContent = "Cuentanos, sonreír más para grabar.";
          recordingStatus.style.display = "none";
        }

        // Delay hasta la pausa
        if (recording && !isSmiling && !wasRecordingPaused && !pauseTimeout) {
          pauseTimeout = setTimeout(() => {
            if (!isSmiling) {
              mediaRecorder.pause();
              pauseStartTime = Date.now();
              clearInterval(recordingTimer);
              const seconds = Math.floor((Date.now() - recordStartTime - pausedTime) / 1000);
              const faltan = MAX_RECORD_SECONDS - seconds;
              recordingStatus.textContent = `Grabado: ${seconds}s / Faltan: ${faltan}s (en pausa)`;
              recordingStatus.classList.add('small');
              message.textContent = "Pausado: Sonríe para continuar...";
              wasRecordingPaused = true;
            }
            pauseTimeout = null;
          }, 1000);
        }

        // Cuando se reanuda por sonreír:
        if (recording && isSmiling && wasRecordingPaused) {
          mediaRecorder.resume();
          if (pauseStartTime) {
            pausedTime += Date.now() - pauseStartTime;
          }
          pauseStartTime = null;
          updateRecordingTime();
          recordingTimer = setInterval(updateRecordingTime, 1000);
          recordingStatus.textContent = `Grabando: ${Math.floor((Date.now() - recordStartTime - pausedTime) / 1000)}s`;
          recordingStatus.classList.remove('small');
          message.textContent = "Grabación reanudada";
          wasRecordingPaused = false;
        }
      });
    }
  }, 200);
});

// Controla el overlay SOLO con la barra espaciadora
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    if (!overlayShown) {
      showOverlay();
      overlayShown = true;
      video.style.visibility = "hidden";
    } else {
      hideOverlay();
      overlayShown = false;
      video.style.visibility = "visible";
    }
  }
});

function updateRecordingTime() {
  let elapsed = Math.floor((Date.now() - recordStartTime - pausedTime) / 1000);
  let remaining = MAX_RECORD_SECONDS - elapsed;
  if (remaining < 0) remaining = 0;
  if (wasRecordingPaused) {
    recordingStatus.textContent = `Grabado: ${elapsed}s / Faltan: ${remaining}s (en pausa)`;
    recordingStatus.classList.add('small');
  } else {
    recordingStatus.textContent = `Grabando: ${remaining}s`;
    recordingStatus.classList.remove('small');
  }
  // Limite de 20 segundos
  if (recording && elapsed >= MAX_RECORD_SECONDS) {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
      clearInterval(recordingTimer);
      recording = false;
      wasRecordingPaused = false;
      pauseTimeout = null;
      pauseStartTime = null;
      pausedTime = 0;
      ageGenderCaptured = false;
      fixedAge = null;
      fixedGender = null;
      message.textContent = "¡Listo! El video se ha guardado.";
      recordingStatus.style.display = "none";
      // Bloquea nueva grabación por 5 segundos
      recordingCooldownUntil = Date.now() + 5000;
      setTimeout(() => {
        recordingStatus.textContent = "";
      }, 1000);
    }
  }
}

// Nueva función uploadVideo
function uploadVideo(blob, mostrarMensaje) {
  const formData = new FormData();
  formData.append("video", blob);

  fetch("/upload", {
    method: "POST",
    body: formData
  })
    .then(res => res.json())
    .then(data => {
      console.log("Видео загружено:", data.message);
      if (mostrarMensaje) {
        message.textContent = "Video subido correctamente.";
      }
    })
    .catch(err => {
      console.error("Ошибка при загрузке видео:", err);
    });
}

// Promedio Age и Genero
function mode(array) {
  return array
    .sort((a, b) =>
      array.filter(v => v === a).length
      - array.filter(v => v === b).length
    ).pop();
}