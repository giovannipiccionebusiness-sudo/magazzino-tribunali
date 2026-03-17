const API = "https://script.google.com/macros/s/AKfycbw3-SdPRd9CR_RKDz80U4pKKoSmoakyosRMHs92nl80KaN6p1QbZQwmBiot8Tvv8dxd/exec";

let scanner;

function startScanner(){

scanner = new Html5Qrcode("reader");

scanner.start(
{ facingMode:"environment" },

{
fps:10,
qrbox:250
},

(decodedText)=>{

document.getElementById("barcode").value = decodedText;

scanner.stop();

}

);

}

async function verifica(){

const codice = document.getElementById("barcode").value;

const res = await fetch(API,{
method:"POST",
body:JSON.stringify({

action:"verifica",
barcode:codice

})

});

const data = await res.json();

alert(JSON.stringify(data));

}

async function carica(){

movimento("CARICO");

}

async function scarica(){

movimento("SCARICO");

}

async function movimento(tipo){

const codice=document.getElementById("barcode").value;
const qta=document.getElementById("qta").value;
const sede=document.getElementById("sede").value;

await fetch(API,{
method:"POST",
body:JSON.stringify({

action:"movimento",
barcode:codice,
qta:qta,
tipo:tipo,
sede:sede

})

});

alert("Movimento salvato");

}

async function caricaDDT(){

const file=document.getElementById("ddt").files[0];

const reader=new FileReader();

reader.onload=async function(){

await fetch(API,{
method:"POST",
body:JSON.stringify({

action:"ddt",
file:reader.result

})

});

alert("DDT caricato");

};

reader.readAsDataURL(file);

}
