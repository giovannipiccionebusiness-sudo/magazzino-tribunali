const API_URL = "https://script.google.com/macros/s/AKfycbzkdFC-9qrwcBkO2y5UefeXgRfcvPaQINZKxALLKRpDpnXzRq_9jVQ9aq2a8LwAQi_F/exec";
const DDT_CHUNK_SIZE = 45000;

let APP = {
  user: null,
  actionType: null,
  scanner: null,
  scannerRunning: false,
  progressTimer: null
};

function $(id){ return document.getElementById(id); }

function show(id){ $(id).classList.remove("hidden"); }
function hide(id){ $(id).classList.add("hidden"); }

function setMsg(id, text, cls){
  const el = $(id);
  el.className = "msg " + cls;
  el.innerHTML = text;
  el.classList.remove("hidden");
}

function startProgress(title, text){
  $("progressTitle").textContent = title || "Operazione in corso…";
  $("progressText").textContent = text || "Attendere qualche secondo…";
  $("progressBar").style.width = "12%";
  show("progressOverlay");

  let p = 12;
  clearInterval(APP.progressTimer);
  APP.progressTimer = setInterval(() => {
    if (p < 86) {
      p += Math.random() * 12;
      if (p > 86) p = 86;
      $("progressBar").style.width = p + "%";
    }
  }, 350);
}

function stopProgress(finalText){
  clearInterval(APP.progressTimer);
  $("progressBar").style.width = "100%";
  if (finalText) $("progressText").textContent = finalText;
  setTimeout(() => {
    hide("progressOverlay");
    $("progressBar").style.width = "0%";
  }, 350);
}

function saveLoginSession(user){
  localStorage.setItem("magazzino_user", JSON.stringify(user));
}

function loadLoginSession(){
  try {
    const raw = localStorage.getItem("magazzino_user");
    return raw ? JSON.parse(raw) : null;
  } catch(e){
    return null;
  }
}

function clearLoginSession(){
  localStorage.removeItem("magazzino_user");
}

function restoreSessionIfAvailable(){
  const saved = loadLoginSession();
  if (!saved) return false;

  APP.user = saved;
  $("chipOperatore").textContent = "Operatore: " + (saved.nome || "--");
  $("chipRuolo").textContent = "Ruolo: " + (saved.role || "--");
  loadSedi(saved.sediDisponibili || []);

  hide("loginCard");
  show("appCard");
  setMsg("mainMsg", "Sessione ripristinata.", "ok");
  return true;
}

function jsonpRequest(params){
  return new Promise((resolve, reject) => {
    const callbackName = "jsonp_cb_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
    params.callback = callbackName;

    const query = new URLSearchParams(params).toString();
    const script = document.createElement("script");
    script.src = API_URL + "?" + query;

    let finished = false;
    const cleanup = () => {
      if (script.parentNode) script.parentNode.removeChild(script);
      delete window[callbackName];
    };

    window[callbackName] = function(data){
      finished = true;
      cleanup();
      resolve(data);
    };

    script.onerror = function(){
      if (!finished) {
        cleanup();
        reject(new Error("Errore di comunicazione con Apps Script"));
      }
    };

    document.body.appendChild(script);

    setTimeout(() => {
      if (!finished) {
        cleanup();
        reject(new Error("Timeout di comunicazione con Apps Script"));
      }
    }, 20000);
  });
}

async function initApp(){
  try {
    startProgress("Avvio app", "Caricamento operatori…");

    const data = await jsonpRequest({ action: "init" });

    const sel = $("operatoreSelect");
    sel.innerHTML = '<option value="">Seleziona operatore</option>';

    (data.operatori || []).forEach(op => {
      const opt = document.createElement("option");
      opt.value = op.id;
      opt.textContent = op.nome + (op.sedeAssegnata ? " - " + op.sedeAssegnata : "");
      sel.appendChild(opt);
    });

    restoreSessionIfAvailable();
    stopProgress("Operatori caricati");
  } catch (err) {
    stopProgress();
    setMsg("loginMsg", err.message, "err");
  }
}

async function doLogin(){
  const operatoreId = $("operatoreSelect").value;
  const pin = $("pinOperatore").value.trim();

  if (!operatoreId) {
    setMsg("loginMsg", "Seleziona un operatore.", "err");
    return;
  }
  if (!pin) {
    setMsg("loginMsg", "Inserisci il PIN.", "err");
    return;
  }

  try {
    startProgress("Accesso", "Verifica credenziali…");

    const data = await jsonpRequest({
      action: "login",
      operatoreId: operatoreId,
      pin: pin
    });

    if (!data.ok) throw new Error(data.error || "Login non riuscito");

    APP.user = data;
    saveLoginSession(data);

    $("chipOperatore").textContent = "Operatore: " + (data.nome || "--");
    $("chipRuolo").textContent = "Ruolo: " + (data.role || "--");

    loadSedi(data.sediDisponibili || []);
    hide("loginCard");
    show("appCard");

    setMsg("mainMsg", "Accesso effettuato correttamente.", "ok");
    stopProgress("Accesso completato");
  } catch (err) {
    stopProgress();
    setMsg("loginMsg", err.message, "err");
  }
}

function logoutApp(){
  stopScanner();
  clearLoginSession();
  APP.user = null;
  show("loginCard");
  hide("appCard");
  hide("movementCard");
  hide("ddtCard");
  $("pinOperatore").value = "";
  setMsg("loginMsg", "Sessione chiusa.", "info");
}

function loadSedi(sedi){
  const sel = $("sede");
  sel.innerHTML = "";
  sedi.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    sel.appendChild(opt);
  });
}

function openAction(tipo){
  stopScanner();
  APP.actionType = tipo;
  $("movementTitle").textContent = tipo === "CARICO" ? "Carica Prodotto" : "Scarica Prodotto";
  $("barcode").value = "";
  $("qty").value = 1;
  $("noteMov").value = "";
  hide("productMsg");
  hide("reader");
  hide("ddtCard");
  show("movementCard");
}

function closeMovement(){
  stopScanner();
  hide("movementCard");
}

function openDdt(){
  stopScanner();
  hide("movementCard");
  $("ddtFile").value = "";
  $("ddtNote").value = "";
  $("ddtPreview").src = "";
  hide("ddtPreview");
  hide("ddtMsg");
  show("ddtCard");
}

function closeDdt(){
  hide("ddtCard");
}

function startScanner(){
  const readerId = "reader";
  show(readerId);

  if (APP.scannerRunning) return;

  APP.scanner = new Html5Qrcode(readerId);

  Html5Qrcode.getCameras().then(cameras => {
    if (!cameras || !cameras.length) {
      setMsg("productMsg", "Nessuna fotocamera disponibile.", "err");
      return;
    }

    APP.scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 250 },
      decodedText => {
        $("barcode").value = decodedText;
        setMsg("productMsg", "Codice rilevato: <b>" + decodedText + "</b>", "ok");
        stopScanner();
      },
      () => {}
    ).then(() => {
      APP.scannerRunning = true;
      setMsg("productMsg", "Scanner attivo. Inquadra il QR del prodotto.", "info");
    }).catch(err => {
      setMsg("productMsg", "Errore fotocamera: " + err, "err");
    });
  }).catch(err => {
    setMsg("productMsg", "Errore fotocamera: " + err, "err");
  });
}

function stopScanner(){
  if (APP.scanner && APP.scannerRunning) {
    APP.scanner.stop().then(() => {
      APP.scannerRunning = false;
      hide("reader");
    }).catch(() => {
      APP.scannerRunning = false;
      hide("reader");
    });
  } else {
    APP.scannerRunning = false;
    hide("reader");
  }
}

async function lookupProduct(){
  const sede = $("sede").value;
  const barcode = $("barcode").value.trim();

  if (!barcode) {
    setMsg("productMsg", "Inserisci il codice.", "err");
    return;
  }

  try {
    startProgress("Verifica prodotto", "Ricerca del prodotto in magazzino…");

    const res = await jsonpRequest({
      action: "verificaProdotto",
      sede: sede,
      barcode: barcode,
      operatoreId: APP.user.operatoreId
    });

    stopProgress("Prodotto verificato");

    if (!res.found) {
      setMsg("productMsg", "Prodotto non presente in questa sede.", "warn");
      return;
    }

    setMsg(
      "productMsg",
      "<b>Prodotto:</b> " + res.product.prodotto + "<br>" +
      "<b>Codice:</b> " + res.product.barcode + "<br>" +
      "<b>Unità:</b> " + (res.product.unita || "-") + "<br>" +
      "<b>Giacenza:</b> " + res.product.giacenza + "<br>" +
      "<b>Scorta minima:</b> " + res.product.scortaMinima,
      "ok"
    );
  } catch (err) {
    stopProgress();
    setMsg("productMsg", err.message, "err");
  }
}

async function saveMovement(){
  const sede = $("sede").value;
  const barcode = $("barcode").value.trim();
  const qta = Number($("qty").value || 0);
  const note = $("noteMov").value.trim();

  if (!barcode) {
    setMsg("mainMsg", "Codice mancante.", "err");
    return;
  }
  if (!qta || qta <= 0) {
    setMsg("mainMsg", "Quantità non valida.", "err");
    return;
  }

  try {
    startProgress("Salvataggio movimento", "Aggiornamento giacenza e storico…");

    const res = await jsonpRequest({
      action: "movimento",
      sede: sede,
      barcode: barcode,
      qta: qta,
      tipo: APP.actionType,
      note: note,
      operatoreId: APP.user.operatoreId
    });

    if (!res.ok) throw new Error(res.error || "Movimento non salvato");

    stopProgress("Movimento salvato");

    let msg =
      "Movimento registrato.<br>" +
      "<b>Prodotto:</b> " + res.prodotto + "<br>" +
      "<b>Giacenza precedente:</b> " + res.giacenzaPrecedente + "<br>" +
      "<b>Nuova giacenza:</b> " + res.giacenzaNuova;

    if (res.sottoScorta) {
      setMsg("mainMsg", msg + "<br><b>Attenzione:</b> sotto scorta minima.", "warn");
    } else {
      setMsg("mainMsg", msg, "ok");
    }

    closeMovement();
  } catch (err) {
    stopProgress();
    setMsg("mainMsg", err.message, "err");
  }
}

function previewDdt(input){
  const file = input.files && input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e){
    $("ddtPreview").src = e.target.result;
    show("ddtPreview");
  };
  reader.readAsDataURL(file);
}

function resizeImageToJpegBase64(file, maxWidth = 1400, quality = 0.72){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = function(e){
      const img = new Image();

      img.onload = function(){
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve(dataUrl);
      };

      img.onerror = reject;
      img.src = e.target.result;
    };

    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function splitStringIntoChunks(str, chunkSize){
  const chunks = [];
  for (let i = 0; i < str.length; i += chunkSize) {
    chunks.push(str.substring(i, i + chunkSize));
  }
  return chunks;
}

async function uploadDDT(){
  const sede = $("sede").value;
  const note = $("ddtNote").value.trim();
  const file = $("ddtFile").files && $("ddtFile").files[0];

  if (!file) {
    setMsg("ddtMsg", "Seleziona una foto del DDT.", "err");
    return;
  }

  try {
    startProgress("Preparazione DDT", "Compressione immagine in corso…");

    const dataUrl = await resizeImageToJpegBase64(file);
    const base64 = dataUrl.split(",")[1];
    const chunks = splitStringIntoChunks(base64, DDT_CHUNK_SIZE);
    const uploadId = "DDT_" + Date.now() + "_" + Math.floor(Math.random() * 100000);

    await jsonpRequest({
      action: "ddtStart",
      uploadId: uploadId,
      sede: sede,
      note: note,
      operatoreId: APP.user.operatoreId,
      fileName: file.name || "ddt.jpg",
      totalChunks: chunks.length
    });

    for (let i = 0; i < chunks.length; i++) {
      $("progressTitle").textContent = "Caricamento DDT";
      $("progressText").textContent = "Invio blocco " + (i + 1) + " di " + chunks.length;
      $("progressBar").style.width = Math.round(((i + 1) / chunks.length) * 100) + "%";

      const res = await jsonpRequest({
        action: "ddtChunk",
        uploadId: uploadId,
        index: i,
        chunk: chunks[i]
      });

      if (!res.ok) throw new Error(res.error || "Errore invio blocco DDT");
    }

    const finishRes = await jsonpRequest({
      action: "ddtFinish",
      uploadId: uploadId
    });

    if (!finishRes.ok) throw new Error(finishRes.error || "Errore finale upload DDT");

    stopProgress("DDT salvato");
    setMsg(
      "ddtMsg",
      'DDT caricato correttamente.<br><a href="' + finishRes.url + '" target="_blank">Apri file</a>',
      "ok"
    );
  } catch (err) {
    stopProgress();
    setMsg("ddtMsg", err.message, "err");
  }
}

window.onload = initApp;
