// --- ARCHIVO app.js (VERSIÓN FINAL Y DEFINITIVA - TODO CORREGIDO) ---
document.addEventListener('DOMContentLoaded', () => {
    // --- SELECTORES DEL DOM ---
    const gridContainer = document.getElementById('instrument-grid');
    const addSamplerTrackBtn = document.getElementById('add-sampler-track-btn');
    const addMicTrackBtn = document.getElementById('add-mic-track-btn');
    const samplerTrackTemplate = document.getElementById('sampler-track-template');
    const micTrackTemplate = document.getElementById('mic-track-template');
    const playBtn = document.getElementById('play-btn');
    const stopBtn = document.getElementById('stop-btn');
    const tempoInput = document.getElementById('tempo-input');
    const stepsInput = document.getElementById('steps-input');
    const skinSelector = document.getElementById('skin-selector');
    const recordBtn = document.getElementById('record-btn');
    const clearBtn = document.getElementById('clear-btn');
    const swingSlider = document.getElementById('swing-slider');
    const swingDisplay = document.getElementById('swing-display');
    const masterVolumeSlider = document.getElementById('master-volume');
    
    // --- ESTADO GLOBAL ---
    let audioContext;
    const tracksState = {};
    let trackCounter = 0;
    let stepsPerTrack = 16;
    let isPlaying = false;
    let currentStep = 0;
    let tempo = 120;
    let swingAmount = 0;
    let intervalId;
    let masterGain, eqLowNode, eqMidNode, eqHighNode;
    let isMixRecording = false, mixMediaRecorder, mixAudioChunks = [];

    // --- INICIALIZACIÓN ---
    function init() {
        addSamplerTrackBtn.addEventListener('click', () => addNewTrack('sampler'));
        addMicTrackBtn.addEventListener('click', () => addNewTrack('mic'));
        playBtn.addEventListener('click', togglePlayback);
        stopBtn.addEventListener('click', stopPlayback);
        clearBtn.addEventListener('click', clearAllPatterns);
        stepsInput.addEventListener('change', () => changeSequencerLength(parseInt(stepsInput.value)));
        tempoInput.addEventListener('change', (e) => {
            tempo = parseInt(e.target.value);
            if (isPlaying) { stopPlayback(); togglePlayback(); }
        });
        skinSelector.addEventListener('change', (e) => {
            document.body.className = e.target.value === 'classic' ? 'classic' : '';
        });
        swingSlider.addEventListener('input', e => {
            swingAmount = parseFloat(e.target.value);
            swingDisplay.textContent = `${Math.round(swingAmount / 0.7 * 100)}%`;
        });
        recordBtn.addEventListener('click', async () => {
            await initAudioContext();
            isMixRecording ? stopMixRecording() : startMixRecording();
        });
        addNewTrack('sampler');
    }

    async function initAudioContext() {
        if (audioContext && audioContext.state === 'running') return;
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const mediaStreamDestination = audioContext.createMediaStreamDestination();
            masterGain = audioContext.createGain();
            eqLowNode = audioContext.createBiquadFilter(); eqLowNode.type = 'lowshelf'; eqLowNode.frequency.value = 320;
            eqMidNode = audioContext.createBiquadFilter(); eqMidNode.type = 'peaking'; eqMidNode.frequency.value = 1000; eqMidNode.Q.value = 1;
            eqHighNode = audioContext.createBiquadFilter(); eqHighNode.type = 'highshelf'; eqHighNode.frequency.value = 3200;
            
            eqLowNode.connect(eqMidNode).connect(eqHighNode).connect(masterGain);
            masterGain.connect(audioContext.destination);
            masterGain.connect(mediaStreamDestination);
            
            mixMediaRecorder = new MediaRecorder(mediaStreamDestination.stream);
            setupMasterControls();
        }
        if (audioContext.state === 'suspended') await audioContext.resume();
    }
    
    function setupMasterControls() {
        masterVolumeSlider.addEventListener('input', e => { if (masterGain) masterGain.gain.value = parseFloat(e.target.value); });
        masterVolumeSlider.addEventListener('dblclick', () => { masterVolumeSlider.value = 1; if(masterGain) masterGain.gain.value = 1; });
        if (window.jQuery && $.fn.knob) {
             $('#eq-low, #eq-mid, #eq-high').knob({
                'min': -24, 'max': 24, 'step': 1, 'angleOffset': -125, 'angleArc': 250, 'fgColor': '#3498db', 'bgColor': '#555', 'width': 45, 'height': 45,
                'release': function(v) {
                    const id = this.i[0].id;
                    if (id === 'eq-low' && eqLowNode) eqLowNode.gain.value = v;
                    if (id === 'eq-mid' && eqMidNode) eqMidNode.gain.value = v;
                    if (id === 'eq-high' && eqHighNode) eqHighNode.gain.value = v;
                }
            });
        }
    }

    function addNewTrack(type) {
        trackCounter++;
        const id = `track-${trackCounter}`;
        const template = (type === 'sampler') ? samplerTrackTemplate : micTrackTemplate;
        if (!template) return;
        const trackNode = template.content.cloneNode(true).querySelector('.track');
        trackNode.dataset.id = id;
        trackNode.dataset.type = type;
        if (type === 'sampler') {
            trackNode.querySelector('.track-title').textContent = `Sampler ${trackCounter}`;
            const fileInput = trackNode.querySelector('.file-input');
            const loadButton = trackNode.querySelector('.load-button');
            fileInput.id = `load-${id}`;
            loadButton.setAttribute('for', fileInput.id);
        }
        gridContainer.appendChild(trackNode);
        initializeTrackState(id, trackNode);
    }
    
    function initializeTrackState(id, node) {
        tracksState[id] = { node, buffer: null, volume: 0.8, pan: 0, rate: 1, isMuted: false, isSoloed: false, pattern: new Array(256).fill(false) };
        setupTrackControls(id, node);
        updateGridForTrack(node, id);
    }

    function setupTrackControls(id, node) {
        node.querySelector('.remove-track-btn').addEventListener('click', () => removeTrack(id));
        if (node.dataset.type === 'sampler') {
            node.querySelector('.file-input').addEventListener('change', (e) => handleFileUpload(e, id));
        } else {
            node.querySelector('.mic-record-btn').addEventListener('click', (e) => toggleMicRecording(id, e.currentTarget));
        }
        const controls = { '.volume-slider':'volume', '.pan-slider':'pan', '.rate-slider':'rate' };
        for (const selector in controls) {
            const slider = node.querySelector(selector);
            slider.addEventListener('input', e => {
                const prop = controls[selector];
                if (prop === 'rate') {
                    const val = parseFloat(e.target.value);
                    const minp = 0, maxp = 100, minv = Math.log(0.5), maxv = Math.log(2);
                    const scale = (maxv - minv) / (maxp - minp);
                    tracksState[id][prop] = Math.exp(minv + scale * (val - minp));
                } else {
                    tracksState[id][prop] = parseFloat(e.target.value);
                }
            });
            slider.addEventListener('dblclick', () => {
                const prop = controls[selector];
                const defaultValue = (prop === 'pan') ? 0 : 1;
                const sliderDefault = (prop === 'rate') ? 50 : (prop === 'volume' ? 0.8 : defaultValue);
                slider.value = sliderDefault;
                tracksState[id][prop] = defaultValue;
            });
        }
        node.querySelector('.mute-btn').addEventListener('click', (e) => {
            tracksState[id].isMuted = !tracksState[id].isMuted;
            e.currentTarget.classList.toggle('active', tracksState[id].isMuted);
        });
        node.querySelector('.solo-btn').addEventListener('click', (e) => {
            const isNowActive = !tracksState[id].isSoloed;
            if (isNowActive) {
                Object.keys(tracksState).forEach(key => { tracksState[key].isSoloed = false; });
                document.querySelectorAll('.solo-btn.active').forEach(btn => btn.classList.remove('active'));
            }
            tracksState[id].isSoloed = isNowActive;
            e.currentTarget.classList.toggle('active', isNowActive);
            updateAllTracksMuting();
        });
    }

    function removeTrack(id) { if (tracksState[id]) { tracksState[id].node.remove(); delete tracksState[id]; } }
    async function handleFileUpload(event, id) {
        await initAudioContext();
        const file = event.target.files[0];
        const fileNameDisplay = tracksState[id].node.querySelector('.file-name-display');
        const loadButton = tracksState[id].node.querySelector('.load-button');
        if (!file) { fileNameDisplay.textContent = ''; delete tracksState[id].buffer; loadButton.classList.remove('loaded'); return; }
        fileNameDisplay.textContent = file.name;
        loadButton.classList.add('loaded');
        const reader = new FileReader();
        reader.onload = (e) => audioContext.decodeAudioData(e.target.result).then(buffer => tracksState[id].buffer = buffer);
        reader.readAsArrayBuffer(file);
    }
    
    function updateGridForTrack(trackNode, id) {
        const stepsContainer = trackNode.querySelector('.steps');
        stepsContainer.innerHTML = '';
        stepsContainer.style.gridTemplateColumns = `repeat(${stepsPerTrack}, 1fr)`;
        for (let i = 0; i < stepsPerTrack; i++) {
            const step = document.createElement('div');
            step.classList.add('step');
            if(tracksState[id] && tracksState[id].pattern[i]) step.classList.add('active');
            step.addEventListener('click', () => {
                tracksState[id].pattern[i] = !tracksState[id].pattern[i];
                step.classList.toggle('active');
            });
            stepsContainer.appendChild(step);
        }
    }

    function changeSequencerLength(newLength) {
        if (isPlaying) stopPlayback();
        stepsPerTrack = Math.max(4, Math.min(256, newLength));
        stepsInput.value = stepsPerTrack;
        Object.values(tracksState).forEach(ts => updateGridForTrack(ts.node, ts.node.dataset.id));
    }
    function clearAllPatterns() { Object.values(tracksState).forEach(ts => { ts.pattern.fill(false); updateGridForTrack(ts.node, ts.node.dataset.id); }); }
    function updateAllTracksMuting() { const anySoloActive = Object.values(tracksState).some(t => t.isSoloed); Object.values(tracksState).forEach(ts => ts.node.classList.toggle('muted', anySoloActive && !ts.isSoloed)); }
    
    function tick() {
        const anySoloActive = Object.values(tracksState).some(t => t.isSoloed);
        Object.values(tracksState).forEach(trackState => {
            const shouldPlay = !trackState.isMuted && (!anySoloActive || trackState.isSoloed);
            if (trackState.pattern[currentStep] && shouldPlay && trackState.buffer && audioContext) {
                const source = audioContext.createBufferSource();
                source.buffer = trackState.buffer;
                source.playbackRate.value = trackState.rate;
                const panner = audioContext.createStereoPanner();
                panner.pan.value = trackState.pan;
                const gain = audioContext.createGain();
                gain.gain.value = trackState.volume;
                source.connect(panner).connect(gain).connect(eqLowNode);
                source.start();
            }
        });
    }

    function togglePlayback() {
        initAudioContext().then(() => {
            isPlaying = !isPlaying;
            playBtn.classList.toggle('active', isPlaying);
            if (isPlaying) {
                currentStep = 0;
                playStepWithSwing();
            } else {
                clearTimeout(intervalId);
                document.querySelectorAll('.step.current').forEach(s => s.classList.remove('current'));
            }
        });
    }
    
    function playStepWithSwing() {
        let lastStep = (currentStep === 0) ? stepsPerTrack - 1 : currentStep - 1;
        updateVisuals(currentStep, lastStep);
        tick();
        
        const stepDurationMs = (60 / tempo) / 4 * 1000;
        const swingDelay = (currentStep % 2 !== 0) ? stepDurationMs * swingAmount : 0;
        
        currentStep = (currentStep + 1) % stepsPerTrack;
        intervalId = setTimeout(playStepWithSwing, stepDurationMs + swingDelay);
    }
    
    function stopPlayback() {
        if (isPlaying) {
            isPlaying = false;
            playBtn.classList.remove('active');
            clearTimeout(intervalId);
            document.querySelectorAll('.step.current').forEach(s => s.classList.remove('current'));
        }
    }
    
    function updateVisuals(current, last) {
        for (const id in tracksState) {
            const steps = tracksState[id].node.querySelectorAll('.step');
            if (steps.length > 0) {
                if (steps[last]) steps[last].classList.remove('current');
                if (steps[current]) steps[current].classList.add('current');
            }
        }
    }
    
    // --- LÓGICA DE GRABACIÓN CORREGIDA ---
    async function toggleMicRecording(id, button) {
        await initAudioContext();
        const trackState = tracksState[id];
        const statusEl = trackState.node.querySelector('.mic-status');

        if (trackState.isMicRecording) {
            if (trackState.micRecorder && trackState.micRecorder.state === "recording") trackState.micRecorder.stop();
        } else {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                trackState.isMicRecording = true;
                button.classList.add('recording'); statusEl.textContent = 'Grabando...';
                
                const micChunks = [];
                trackState.micRecorder = new MediaRecorder(stream);
                trackState.micRecorder.ondataavailable = e => micChunks.push(e.data);
                trackState.micRecorder.onstop = async () => {
                    const audioBlob = new Blob(micChunks, { type: 'audio/webm' });
                    const arrayBuffer = await audioBlob.arrayBuffer();
                    audioContext.decodeAudioData(arrayBuffer).then(audioBuffer => {
                        trackState.buffer = audioBuffer;
                        statusEl.textContent = '¡Listo!';
                    }).catch(() => statusEl.textContent = 'Error');
                    stream.getTracks().forEach(track => track.stop());
                    trackState.isMicRecording = false; button.classList.remove('recording');
                };
                trackState.micRecorder.start();
            } catch (err) { alert('No se pudo acceder al micrófono.'); }
        }
    }

    function startMixRecording() {
        if (!mixMediaRecorder) { alert("Error: El grabador de mezcla no está listo."); return; }
        isMixRecording = true;
        mixAudioChunks = [];
        mixMediaRecorder.start();
        mixMediaRecorder.ondataavailable = event => { if (event.data.size > 0) mixAudioChunks.push(event.data); };
        recordBtn.innerHTML = '<span>⏳</span>'; recordBtn.classList.add('active');
    }
    
    function stopMixRecording() {
        if (!mixMediaRecorder) return;
        mixMediaRecorder.onstop = () => {
            if (mixAudioChunks.length === 0) { alert("Grabación vacía."); }
            else {
                const audioBlob = new Blob(mixAudioChunks, { type: 'audio/wav' });
                const audioUrl = URL.createObjectURL(audioBlob);
                const link = document.createElement('a');
                link.href = audioUrl; link.download = `Estudio-de-Ritmos-Mix-${Date.now()}.wav`;
                document.body.appendChild(link); link.click(); document.body.removeChild(link);
            }
            isMixRecording = false;
            recordBtn.innerHTML = '🔴';
            recordBtn.classList.remove('active');
        };
        if (mixMediaRecorder.state === 'recording') mixMediaRecorder.stop();
    }
    
    init(); // ¡Arrancar la aplicación!
});