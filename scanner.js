const WORKER_SCRIPT_PATH = "worker/zxing-0.18.6-worker.js";
const SCAN_AREA_SIZE = 250;
const CANVAS_ID = "scene";

export default function Scanner(domElement) {

	let innerState = {
		get canvas(){
			return domElement.querySelector("#"+CANVAS_ID);
		},
		get context(){

			return context;
		}
	}

	let canvas;
	let context;
	let interval;
	let videoTag;
	let videoStream;
	let worker;
	let workerPath = WORKER_SCRIPT_PATH;
	let scanAreaSize = SCAN_AREA_SIZE;

	let strokeColor = "#000000";

	this.setup = async (basic) => {
		internalSetup();
		if(!basic){
			return await connectCamera();
		}
	}

	this.shutDown = async () =>{
		try{
			videoStream.getVideoTracks()[0].stop();
		}catch(err){
			console.log("Caught an error during video track stop process.", err);
		}

		if (domElement.children.length) {
			domElement.innerHTML = "";
		}

		if(interval){
			clearInterval(interval);
		}
	}

	this.scan = async () => {
		let frame = getDataForScanning();
		let result = await decode(frame);
		if (result) {
			strokeColor = "#008000";
		}else{
			strokeColor = "#000000";
		}
		return result;
	}

	this.scanImageData = async (imageData) => {
		canvas.width = imageData.videoWidth;
		canvas.height = imageData.videoHeight;

		let tempCanvas = document.createElement("canvas");
		let tempContext = tempCanvas.getContext("2d");
		let {width, height} = canvas;
		tempCanvas.width = width;
		tempCanvas.height = height;

		tempContext.putImageData(imageData, 0, 0, width, height);

		//give feedback to user
		await drawFrame(canvas);

		let result = await decode(imageData);
		return result;
	}

	this.changeWorker = (path) => {
		workerPath = path;
	}

	this.setScanAreaSize = (size) => {
		scanAreaSize = size;
	}

	function internalSetup() {
		let id = CANVAS_ID;
		if (!domElement.querySelector("#" + id)) {
			canvas = document.createElement("canvas");
			canvas.id = id;

			context = canvas.getContext("2d");
			context.imageSmoothingEnabled = false;

			canvas.setAttribute("style", "position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);");
			domElement.append(canvas);
		}
	}

	const getCenterArea = () => {
		let size = scanAreaSize;
		let {width, height} = canvas;
		const points = [(width - size) / 2, (height - size) / 2, size, size];
		return points;
	}

	const decode = (imageData) => {
		let promise = new Promise((resolve, reject) => {
			let segments = workerPath.split("/");
			let fileName = segments.pop();
			let basePath  = segments.join("/")+segments.length > 1 ? "/" : "";

			if (!worker) {
				worker = new Worker(workerPath);
				worker.postMessage({
					type: "init",
					payload:{
						basePath
					}
				});
			}

			let waitFor = (message) => {
				try {
					//verify message
					let result;
					let event = message.data;
					let messageType = event.type;
					switch (messageType) {
						case "decode-fail":
							//console.log("got an message with failed decoding status");
							break;
						case "decode-success":
							result = event.payload.result;
							break;
						default:
							console.log("Caught a strange message");
							result = event;
					}

					worker.removeEventListener("message", waitFor);
					worker.removeEventListener("error", errorHandler);
					resolve(result);
				} catch (err) {
					console.log(err);
				}
			}

			let errorHandler = (...args) => {
				worker = undefined;
				reject(...args);
			};

			worker.addEventListener("message", waitFor);

			worker.addEventListener("error", errorHandler);

			worker.postMessage({
				type: "decode",
				payload: {
					imageData,
					filterId: ""
				}
			});
		});

		return promise;
	}

	const connectCamera = async () => {
		return new Promise(async (resolve, reject) => {
			let stream;
			let constraints = {
				audio: false,
				video: {
					facingMode: "environment"
				},
				advanced: [{focusMode: "continuous"}]
			};

			try {
				stream = await navigator.mediaDevices.getUserMedia(constraints);
				const track = stream.getVideoTracks()[0];
				const capabilities = track.getCapabilities();
				console.log(capabilities);

				constraints.video.height = 1080;
				constraints.video.width = 1920;

				await track.applyConstraints(constraints.video);
			} catch (error) {
				console.log("Caught an error during camera connection", error);
				reject();
			}

			let video = document.createElement('video');
			video.autoplay = true;
			video.muted = true;
			video.loop = true;
			if (!gotFullSupport()) {
				video.width = 1;
				video.height = 1;
				video.setAttribute("playsinline", "");
			}
			video.addEventListener("loadeddata", (...args) => {
				canvas.width = video.videoWidth;
				canvas.height = video.videoHeight;
				interval = setInterval(drawFrame, 30);
				resolve(true);
			});

			video.addEventListener("error", reject);
			videoTag = video;

			videoStream = stream;
			video.srcObject = stream;

			//enable autoplay video for Safari desktop and mobile
			if (!gotFullSupport()) {
				domElement.append(video);
			}
		});
	}

	const getDataForScanning = () => {
		let frameAsImageData = context.getImageData(...getCenterArea());

		return frameAsImageData;
	}

	const drawCenterArea = (context) => {
		context.lineWidth = 3;
		context.strokeStyle = strokeColor;
		const centerAreaPoints = getCenterArea();
		context.strokeRect(...centerAreaPoints);
	}

	this.drawOverlay = (centerArea, canvasDimensions) => {
		let size = centerArea[3];
		const {width, height} = canvasDimensions;

		const x = (width - size) / 2;
		const y = (height - size) / 2;

		const backgroundPoints = [
			{x: width, y: 0},
			{x: width, y: height},
			{x: 0, y: height},
			{x: 0, y: 0},
		];

		const holePoints = [
			{x, y: y + size},
			{x: x + size, y: y + size},
			{x: x + size, y},
			{x, y}
		];

		let overlayCanvas = canvas.cloneNode();
		let context = overlayCanvas.getContext("2d");

		domElement.append(overlayCanvas);

		context.beginPath();

		context.moveTo(backgroundPoints[0].x, backgroundPoints[0].y);
		for (let i = 0; i < 4; i++) {
			context.lineTo(backgroundPoints[i].x, backgroundPoints[i].y);
		}

		context.moveTo(holePoints[0].x, holePoints[0].y);
		for (let i = 0; i < 4; i++) {
			context.lineTo(holePoints[i].x, holePoints[i].y);
		}

		context.closePath();

		context.fillStyle = 'rgba(0, 0, 0, 0.5)'
		context.fill();

		drawCenterArea(context);
	}

	let overlay;
	const drawFrame = async (frame) => {
		const {width, height} = canvas;

		if(!overlay){
			this.drawOverlay(getCenterArea(), {width, height});
			overlay = true;
		}

		//context.filter = 'brightness(1.75) contrast(1) grayscale(1)';
		if(!frame){
			await grabFrameFromStream();
		}

		if (!frame) {
			console.log("Dropping frame");
			return;
		}

		context.drawImage(frame, 0, 0, width, height);
	}

	const grabFrameFromStream = async () => {
		if (!gotFullSupport()) {
			return grabFrameAlternative();
		}

		let frame;
		try {
			const track = videoStream.getVideoTracks()[0];
			const imageCapture = new ImageCapture(track);
			frame = await imageCapture.grabFrame();
		} catch (err) {
			console.log("Got a situation during grabFrame from stream process.", err);
		}
		return frame;
	}

	const gotFullSupport = () => {
		return !!window.ImageCapture;
		//return false;
	}

	const grabFrameAlternative = () => {
		let tempCanvas = document.createElement("canvas");
		let tempContext = tempCanvas.getContext("2d");
		let {width, height} = canvas;
		tempCanvas.width = width;
		tempCanvas.height = height;

		tempContext.drawImage(videoTag, 0, 0, width, height);
		return tempCanvas;
	}
}