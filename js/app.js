import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// --- Global Variables ---
let scene, camera, renderer, controls;
let composer, bloomPass, renderPass, outputPass;
let currentModel = null;
let currentModelKey = 'd6';
let wireframeMode = false;
let isAnimating = false; // Flag for explode/reassemble animation
let modelParts = []; // To store individual mesh parts for animation
let originalStates = new Map(); // To store original position/rotation of parts

let isGlowingAndSpinning = false;
let modelPointLight = null;
let particleSystem = null; // Assuming particle functions exist
let baseModelScale = 1.0;
let userScaleMultiplier = 1.0;
const clock = new THREE.Clock();

// --- DOM Element References ---
const sceneContainer = document.getElementById('scene-container');
const loadingIndicator = document.getElementById('loading-indicator');
const rollButton = document.getElementById('roll-button');
const wireframeToggleButton = document.getElementById('wireframe-toggle');
const modelSelect = document.getElementById('model-select');
const themeSelect = document.getElementById('theme-select');
const fateModeToggle = document.getElementById('fate-mode-toggle');
const ambientLightToggle = document.getElementById('light-toggle-ambient');
const directionalLightToggle = document.getElementById('light-toggle-directional');
const glowSpinToggleButton = document.getElementById('glow-spin-toggle');
const sizeSlider = document.getElementById('size-slider');
const sizeValueDisplay = document.getElementById('size-value');
const musicToggleButton = document.getElementById('music-toggle');
const backgroundMusic = document.getElementById('background-music');
const resetViewButton = document.getElementById('reset-view-button');
const historyList = document.getElementById('history-list');
const resultText = document.getElementById('result-text');
const historyLimit = 5;
let rollHistory = Array(historyLimit).fill('-'); // Initialize history

// --- Lighting ---
let ambientLight, directionalLight;
let ambientLightOn = true;
let directionalLightOn = true;

// --- Theme Definitions ---
const themes = {
    default: { name: 'Default Lab', background: new THREE.Color(0xe0e0e0), ambientLightIntensity: 0.8, directionalLightIntensity: 1.5, directionalLightColor: 0xffffff, bloomStrength: 0.4, bloomRadius: 0.3, bloomThreshold: 0.9, glowColor: 0xffaa33 },
    fantasy: { name: 'Mystical Grove', background: new THREE.Color(0x3d5a3d), ambientLightIntensity: 0.6, directionalLightIntensity: 1.0, directionalLightColor: 0xffe0b0, bloomStrength: 0.6, bloomRadius: 0.5, bloomThreshold: 0.75, glowColor: 0x7ec488 },
    scifi: { name: 'Cyber Punk Alley', background: new THREE.Color(0x1a1a2e), ambientLightIntensity: 0.4, directionalLightIntensity: 1.8, directionalLightColor: 0x00ffff, bloomStrength: 0.8, bloomRadius: 0.4, bloomThreshold: 0.65, glowColor: 0x00ffff }
};
let currentTheme = themes.default;

// --- Initialization ---
function init() {
    if (!sceneContainer) { console.error("Scene container not found!"); return; }
    console.log("Initializing Luck Lab...");

    scene = new THREE.Scene();
    scene.background = currentTheme.background;

    camera = new THREE.PerspectiveCamera(60, sceneContainer.clientWidth / sceneContainer.clientHeight, 0.1, 1000);
    camera.position.set(0, 1.2, 3);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(sceneContainer.clientWidth, sceneContainer.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    sceneContainer.appendChild(renderer.domElement);

    renderPass = new RenderPass(scene, camera);
    bloomPass = new UnrealBloomPass(new THREE.Vector2(sceneContainer.clientWidth, sceneContainer.clientHeight), currentTheme.bloomStrength, currentTheme.bloomRadius, currentTheme.bloomThreshold);
    outputPass = new OutputPass();
    composer = new EffectComposer(renderer);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    composer.addPass(outputPass);

    ambientLight = new THREE.AmbientLight(0xffffff, currentTheme.ambientLightIntensity);
    scene.add(ambientLight);
    directionalLight = new THREE.DirectionalLight(currentTheme.directionalLightColor, currentTheme.directionalLightIntensity);
    directionalLight.position.set(5, 10, 7.5);
    scene.add(directionalLight);
    updateLightButtonText();

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = 0.5;
    controls.maxDistance = 20;
    controls.target.set(0, 0, 0);
    controls.update();

    userScaleMultiplier = sizeSlider ? parseFloat(sizeSlider.value) : 1.0;
    if (sizeValueDisplay) sizeValueDisplay.textContent = `${userScaleMultiplier.toFixed(1)}x`;
    updateRollHistoryDisplay();
    setupEventListeners();

    const initialModelPath = getModelPath(currentModelKey);
    if (initialModelPath) {
        console.log("Loading initial model:", currentModelKey);
        loadModel(initialModelPath);
    } else {
        console.error("Could not determine initial model path!");
        if (loadingIndicator) loadingIndicator.style.display = 'none';
    }

    console.log("Initialization complete. Starting animation loop.");
    animate();
}

// --- Model Loading ---
const loader = new GLTFLoader();
function loadModel(path) {
    if (!path) { console.error("loadModel called with undefined path!"); return; }
    if (!scene) { console.error("Scene not initialized for model loading."); return; }
    if (loadingIndicator) loadingIndicator.style.display = 'flex';
    console.log(`[LoadModel] Attempting to load: ${path}`);

    resetAllActionStates(); // Reset animations, fate mode, glow etc.
    if (currentModel) {
        scene.remove(currentModel);
    }
    removeParticles();
    modelParts = []; // Clear parts from previous model
    originalStates.clear(); // Clear stored states

    loader.load(
        path,
        (gltf) => {
            console.log(`[LoadModel] Success: ${path}`);
            currentModel = gltf.scene;

            // Calculate initial scale and center
            try {
                const box = new THREE.Box3().setFromObject(currentModel);
                const size = box.getSize(new THREE.Vector3());
                const maxDim = Math.max(size.x, size.y, size.z);
                baseModelScale = maxDim > 0 ? 1.0 / maxDim : 1.0;
                applyUserScale(); // Apply scale and center
            } catch (e) {
                 console.error("[LoadModel] Error calculating bounds or initial scale:", e);
                 currentModel.position.set(0, 0, 0);
                 currentModel.scale.set(1, 1, 1);
            }

            // --- Find and store mesh parts ---
            currentModel.traverse((object) => {
                if (object.isMesh) {
                    modelParts.push(object);
                    // Store initial state immediately after applying scale/centering
                    originalStates.set(object.uuid, {
                        position: object.position.clone(),
                        quaternion: object.quaternion.clone()
                    });
                }
            });
            console.log(`[LoadModel] Found ${modelParts.length} mesh parts.`);
            if(modelParts.length === 0) {
                console.warn("[LoadModel] No mesh parts found directly in the model. Explosion might not work as expected. Check GLTF structure.");
                // If no direct meshes, maybe the main scene object IS the mesh?
                if (currentModel.isMesh) {
                    modelParts.push(currentModel);
                     originalStates.set(currentModel.uuid, {
                        position: currentModel.position.clone(),
                        quaternion: currentModel.quaternion.clone()
                    });
                     console.log("[LoadModel] Using the main loaded object as the part.");
                } else if (currentModel.children.length > 0 && currentModel.children[0].isMesh) {
                     // Sometimes the mesh is nested one level down
                     currentModel.children.forEach(child => {
                         if(child.isMesh) {
                             modelParts.push(child);
                             originalStates.set(child.uuid, {
                                position: child.position.clone(),
                                quaternion: child.quaternion.clone()
                             });
                         }
                     });
                     console.log(`[LoadModel] Found ${modelParts.length} mesh parts in children.`);
                }
            }

            scene.add(currentModel);

            if (wireframeMode) {
                applyWireframe(true, currentModel);
            }

            if (loadingIndicator) loadingIndicator.style.display = 'none';
            enableControls();
        },
        undefined,
        (error) => {
            console.error('[LoadModel] Error loading model:', error);
            if (loadingIndicator) { loadingIndicator.textContent = 'Error loading model.'; }
            enableControls();
        }
    );
}

// --- Get Model Path ---
function getModelPath(modelKey) {
    switch (modelKey) {
        case 'd6': return 'models/die6.glb';
        case 'd12': return 'models/die12.glb';
        case 'coin': return 'models/coin.glb';
        default: console.error("Unknown model key:", modelKey); return null;
    }
}

// --- Apply User Scale ---
function applyUserScale() {
     if (!currentModel) return;
     if (!sizeSlider || !sizeValueDisplay) return;

    userScaleMultiplier = parseFloat(sizeSlider.value);
    const finalScale = baseModelScale * userScaleMultiplier;
    currentModel.scale.set(finalScale, finalScale, finalScale);
    sizeValueDisplay.textContent = `${userScaleMultiplier.toFixed(1)}x`;

    // Re-center the main model group
    try {
        const scaledBox = new THREE.Box3().setFromObject(currentModel);
        const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
        currentModel.position.x = -scaledCenter.x;
        currentModel.position.y = -scaledBox.min.y;
        currentModel.position.z = -scaledCenter.z;

        // IMPORTANT: After scaling/centering the parent, update stored original states of parts
        // This assumes parts' positions/quaternions are relative to the parent `currentModel`
        originalStates.forEach((state, uuid) => {
             const part = modelParts.find(p => p.uuid === uuid);
             if (part) {
                 state.position.copy(part.position);
                 state.quaternion.copy(part.quaternion);
             }
        });

    } catch (e) {
        console.error("[ApplyUserScale] Error re-centering model after scale:", e);
        currentModel.position.set(0, 0, 0);
    }
}

// --- Explode/Reassemble Action ---
function rollOrFlip() {
    if (!currentModel || isAnimating || isGlowingAndSpinning || modelParts.length === 0) {
        console.warn(`[RollOrFlip] Blocked: Animating: ${isAnimating}, Glowing: ${isGlowingAndSpinning}, Parts: ${modelParts.length}`);
        return;
    }

    console.log("[RollOrFlip] Initiating Explode/Reassemble sequence...");
    isAnimating = true; // Set animation flag
    disableControls();
    if (resultText) resultText.textContent = "Exploding...";

    explodeAnimation(); // Start the animation
}

// --- GSAP Animation Functions ---
function explodeAnimation() {
    console.log("[Animation] Starting Explode...");
    const duration = 0.8; // Duration of explosion
    const stagger = 0.05; // Delay between each part starting animation
    const ease = "power2.out"; // GSAP easing function
    const explosionStrength = 1.5 * userScaleMultiplier; // How far parts move out

    // Use a GSAP timeline for better control
    const tl = gsap.timeline({
        onComplete: () => {
            console.log("[Animation] Explode complete. Starting reassemble...");
            if (resultText) resultText.textContent = "Reassembling...";
            // Add a slight delay before reassembling
            gsap.delayedCall(0.5, reassembleAnimation);
        }
    });

    modelParts.forEach((part, index) => {
        const originalState = originalStates.get(part.uuid);
        if (!originalState) {
            console.warn(`[Explode] No original state found for part UUID: ${part.uuid}`);
            return; // Skip if no original state
        }

        // Calculate explosion direction (away from the original position relative to center)
        // For simplicity, let's use original position if it's not zero, otherwise random
        let explosionVector = originalState.position.clone().normalize();
        if (explosionVector.lengthSq() < 0.01) { // If original position is near center
            explosionVector.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        }

        // Target position for explosion
        const targetPosition = originalState.position.clone().add(
            explosionVector.multiplyScalar(explosionStrength)
        );

        // Target rotation (random small rotation)
        const targetRotation = {
            x: part.rotation.x + (Math.random() - 0.5) * Math.PI, // Add random rotation
            y: part.rotation.y + (Math.random() - 0.5) * Math.PI,
            z: part.rotation.z + (Math.random() - 0.5) * Math.PI
        };

        // Add tween to the timeline
        tl.to(part.position, {
            x: targetPosition.x,
            y: targetPosition.y,
            z: targetPosition.z,
            duration: duration,
            ease: ease
        }, index * stagger); // Stagger start time

        tl.to(part.rotation, {
            x: targetRotation.x,
            y: targetRotation.y,
            z: targetRotation.z,
            duration: duration,
            ease: ease
        }, index * stagger); // Stagger start time (same as position)
    });
}

function reassembleAnimation() {
    console.log("[Animation] Starting Reassemble...");
    const duration = 0.7;
    const stagger = 0.04;
    const ease = "power2.in"; // Ease in for reassembly

    const tl = gsap.timeline({
        onComplete: () => {
            console.log("[Animation] Reassemble complete.");
            // Animation finished, determine outcome
            determineOutcomeAndFinish();
        }
    });

    modelParts.forEach((part, index) => {
        const originalState = originalStates.get(part.uuid);
        if (!originalState) {
             console.warn(`[Reassemble] No original state found for part UUID: ${part.uuid}`);
             return; // Skip if no original state
        }

        // Animate back to original position
        tl.to(part.position, {
            x: originalState.position.x,
            y: originalState.position.y,
            z: originalState.position.z,
            duration: duration,
            ease: ease
        }, index * stagger);

        // Animate back to original rotation (using quaternion for accuracy)
        tl.to(part.quaternion, {
            x: originalState.quaternion.x,
            y: originalState.quaternion.y,
            z: originalState.quaternion.z,
            w: originalState.quaternion.w,
            duration: duration,
            ease: ease,
             onUpdate: function() {
                 // Ensure Three.js knows the quaternion has updated
                 part.rotation.setFromQuaternion(part.quaternion);
             }
        }, index * stagger);
    });
}


// --- Finish Roll/Flip & Determine Outcome ---
function determineOutcomeAndFinish() {
    // This function is now called *after* the reassemble animation completes

    if (!currentModel) {
        console.error("[Finish] No model found!");
        isAnimating = false; // Reset flag
        enableControls();
        return;
    }

    console.log("[Finish] Determining outcome...");
    let outcome;
    const selectedValue = modelSelect.value;

    if (selectedValue === 'd6') { outcome = Math.floor(Math.random() * 6) + 1; }
    else if (selectedValue === 'd12') { outcome = Math.floor(Math.random() * 12) + 1; }
    else if (selectedValue === 'coin') { outcome = Math.random() < 0.5 ? "Heads" : "Tails"; }
    else { outcome = "N/A"; }

    if (resultText) resultText.textContent = `${selectedValue.toUpperCase()}: ${outcome}`;
    if (selectedValue === 'coin') {
         if (resultText) resultText.textContent = `Coin: ${outcome}`;
    }


    addRollToHistory(outcome);
    spawnParticles();

    // Reset animation flag *after* everything is done
    isAnimating = false;
    console.log("[Finish] Animation flag reset.");

    // Re-enable controls if appropriate
    if (!isGlowingAndSpinning && !(fateModeToggle && fateModeToggle.checked)) {
        enableControls();
    } else {
         if (controls) controls.enabled = true; // Ensure camera is enabled
         console.log("[Finish] Controls not fully enabled due to Glow or Fate Mode.");
    }
    console.log("[Finish] Outcome:", outcome);
}

// --- Particle System ---
// Dummy implementations - replace with your actual particle code if needed
function createParticleMaterial() { /* console.log("[Particles] Create material (dummy)"); */ }
function spawnParticles() { console.log("[Particles] Spawn (dummy)"); }
function updateParticles(deltaTime) { /* console.log("[Particles] Update (dummy)"); */ }
function removeParticles() { console.log("[Particles] Remove (dummy)"); }
// --- End Particle System Dummies ---

// --- History Management ---
function addRollToHistory(result) {
    if (result === undefined || result === null) return;
    rollHistory.unshift(String(result));
    if (rollHistory.length > historyLimit) { rollHistory.pop(); }
    while (rollHistory.length < historyLimit) { rollHistory.push('-'); }
    // console.log("[History] Added result:", result, " | New history:", rollHistory);
    updateRollHistoryDisplay();
}

function updateRollHistoryDisplay() {
    if (!historyList) { return; }
    const listItems = historyList.querySelectorAll('li');
    // console.log(`[History Display] Updating ${listItems.length} list items...`);
    listItems.forEach((item, index) => {
        if (item) { item.textContent = (index < rollHistory.length) ? rollHistory[index] : '-'; }
    });
}

// --- Wireframe Toggle ---
function applyWireframe(forceState, model = currentModel) {
    if (!model) return;
    if (forceState === undefined) { wireframeMode = !wireframeMode; }
    else { wireframeMode = forceState; }
    const newState = wireframeMode;
    console.log(`[Wireframe] Setting wireframe mode to: ${newState}`);
    if (wireframeToggleButton) { wireframeToggleButton.textContent = newState ? "Hide Wireframe" : "View Wireframe"; }
    let appliedCount = 0;
    model.traverse((object) => {
        if (object.isMesh && object.material) {
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach(mat => {
                if (mat.wireframe !== undefined) { mat.wireframe = newState; appliedCount++; }
            });
        }
    });
    console.log(`[Wireframe] Applied state to ${appliedCount} materials.`);
}

// --- Fate Mode ---
let fateIntervalId = null;
function toggleFateMode() {
    if (!fateModeToggle) return;
    if (fateModeToggle.checked) {
        if (fateIntervalId) { clearInterval(fateIntervalId); }
        fateIntervalId = setInterval(() => {
            console.log("[Fate Mode] Interval triggered. Attempting roll...");
            rollOrFlip(); // Use the new explode/reassemble animation
        }, 10000);
        console.log(`[Fate Mode] ON. Interval ID: ${fateIntervalId}`);
        disableControls();
        if(fateModeToggle) fateModeToggle.disabled = false;
        if(controls) controls.enabled = true;
    } else {
        if (fateIntervalId) {
            clearInterval(fateIntervalId);
            console.log(`[Fate Mode] OFF. Cleared interval ID: ${fateIntervalId}`);
            fateIntervalId = null;
        }
        enableControls();
    }
}

// --- Glow & Spin ---
function toggleGlowAndSpin() {
     if (isGlowingAndSpinning) {
         console.log("[GlowToggle] Currently ON. Turning OFF.");
         isGlowingAndSpinning = false;
         updateGlowAndSpinVisuals();
    } else {
        if (!currentModel || isAnimating || !glowSpinToggleButton) { // Also block if exploding/reassembling
            console.warn(`[GlowToggle] Blocked turning ON: Animating: ${isAnimating}, Model: ${!!currentModel}, Button: ${!!glowSpinToggleButton}`);
            return;
        }
        console.log("[GlowToggle] Currently OFF. Turning ON.");
        isGlowingAndSpinning = true;
        updateGlowAndSpinVisuals();
    }
}

function forceStopGlowAndSpin() { // Keep this as is
    if (isGlowingAndSpinning) {
        console.log("[GlowStop] Forcing Glow & Spin OFF.");
        isGlowingAndSpinning = false;
        updateGlowAndSpinVisuals();
    }
}

function updateGlowAndSpinVisuals() { // Keep this as is
     if (!glowSpinToggleButton || !scene) return;
     if (isGlowingAndSpinning) {
        console.log("[GlowVisuals] Turning ON");
        disableControls(true);
        if (currentModel) {
            const lightColor = currentTheme.glowColor || 0xffaa33;
            modelPointLight = new THREE.PointLight(lightColor, 5.0, 5);
            try {
                const modelBox = new THREE.Box3().setFromObject(currentModel);
                const modelCenter = modelBox.getCenter(new THREE.Vector3());
                const modelSize = modelBox.getSize(new THREE.Vector3());
                modelPointLight.position.set( modelCenter.x, modelCenter.y + modelSize.y * 0.6, modelCenter.z );
                scene.add(modelPointLight);
            } catch(e) { console.error("[GlowVisuals] Error adding point light:", e); if (modelPointLight && scene) scene.remove(modelPointLight); modelPointLight = null; }
        } else { console.warn("[GlowVisuals] Cannot add point light, currentModel is null."); }
        glowSpinToggleButton.textContent = "Stop Glowing";
        glowSpinToggleButton.classList.add('active');
        if(glowSpinToggleButton) glowSpinToggleButton.disabled = false;
    } else {
        console.log("[GlowVisuals] Turning OFF");
        if (modelPointLight) { if (scene) scene.remove(modelPointLight); modelPointLight.dispose(); modelPointLight = null; }
        if (!isAnimating && !(fateModeToggle && fateModeToggle.checked)) { enableControls(); }
        else { if (controls) controls.enabled = true; if (glowSpinToggleButton) glowSpinToggleButton.disabled = isAnimating; }
        glowSpinToggleButton.textContent = "Glow & Spin";
        glowSpinToggleButton.classList.remove('active');
    }
}

// --- Theme Change ---
function changeTheme(themeKey) { // Keep this as is
    if (!themes[themeKey]) { console.warn(`[Theme] Theme key "${themeKey}" not found.`); return; }
    currentTheme = themes[themeKey];
    console.log(`[Theme] Changing to: ${currentTheme.name}`);
    if (scene) scene.background = currentTheme.background;
    if (ambientLight) ambientLight.intensity = currentTheme.ambientLightIntensity * (ambientLightOn ? 1 : 0);
    if (directionalLight) { directionalLight.intensity = currentTheme.directionalLightIntensity * (directionalLightOn ? 1 : 0); directionalLight.color.set(currentTheme.directionalLightColor); }
    if (bloomPass) { bloomPass.strength = currentTheme.bloomStrength; bloomPass.radius = currentTheme.bloomRadius; bloomPass.threshold = currentTheme.bloomThreshold; }
    if (isGlowingAndSpinning && modelPointLight) { modelPointLight.color.set(currentTheme.glowColor || 0xffaa33); }
}

// --- Music Toggle ---
function toggleMusic() { // Keep this as is
    if (!backgroundMusic || !musicToggleButton) return;
    if (backgroundMusic.paused) { backgroundMusic.play().then(() => { musicToggleButton.textContent = "Pause Music"; musicToggleButton.classList.add('playing'); }).catch(error => console.error("[Music] Playback failed:", error)); }
    else { backgroundMusic.pause(); musicToggleButton.textContent = "Play Music"; musicToggleButton.classList.remove('playing'); }
}

// --- Lighting Toggles ---
function toggleAmbientLight() { // Keep this as is
    ambientLightOn = !ambientLightOn;
    if (ambientLight) { ambientLight.intensity = currentTheme.ambientLightIntensity * (ambientLightOn ? 1 : 0); console.log(`[Light] Ambient Light ${ambientLightOn ? 'ON' : 'OFF'}. Intensity: ${ambientLight.intensity.toFixed(2)}`); }
    updateLightButtonText();
}
function toggleDirectionalLight() { // Keep this as is
    directionalLightOn = !directionalLightOn;
    if (directionalLight) { directionalLight.intensity = currentTheme.directionalLightIntensity * (directionalLightOn ? 1 : 0); console.log(`[Light] Directional Light ${directionalLightOn ? 'ON' : 'OFF'}. Intensity: ${directionalLight.intensity.toFixed(2)}`); }
     updateLightButtonText();
}
function updateLightButtonText() { // Keep this as is
     if (ambientLightToggle) ambientLightToggle.textContent = `Ambient Light ${ambientLightOn ? 'ON' : 'OFF'}`;
     if (directionalLightToggle) directionalLightToggle.textContent = `Directional Light ${directionalLightOn ? 'ON' : 'OFF'}`;
}

// --- Reset Camera View ---
function resetCameraView() { // Keep this as is
    if (camera && controls) { console.log("[ResetView] Resetting camera position and controls target."); camera.position.set(0, 1.2, 3); controls.target.set(0, 0, 0); camera.lookAt(0, 0, 0); controls.update(); }
    else { console.warn("[ResetView] Camera or controls not ready."); }
}

// --- Control Management ---
function disableControls(keepCameraActive = false) {
    // console.log(`[Controls] Disabling (keepCamera: ${keepCameraActive})`);
    if (rollButton) rollButton.disabled = true;
    if (fateModeToggle) fateModeToggle.disabled = true;
    if (glowSpinToggleButton) glowSpinToggleButton.disabled = true; // Disable glow toggle during explode/reassemble
    if (modelSelect) modelSelect.disabled = true;
    if (themeSelect) themeSelect.disabled = true;
    if (sizeSlider) sizeSlider.disabled = true;
    if (wireframeToggleButton) wireframeToggleButton.disabled = true;
    if (resetViewButton) resetViewButton.disabled = true;
    if (ambientLightToggle) ambientLightToggle.disabled = true;
    if (directionalLightToggle) directionalLightToggle.disabled = true;
    if (musicToggleButton) musicToggleButton.disabled = true;

    if (!keepCameraActive && controls) { controls.enabled = false; }
}
function enableControls() {
    // console.log(`[Controls] Enabling | Animating: ${isAnimating}, Glowing: ${isGlowingAndSpinning}, Fate: ${fateModeToggle?.checked}`);
    const canInteract = !isAnimating && !isGlowingAndSpinning;
    const allowRollActions = canInteract && !(fateModeToggle && fateModeToggle.checked);

    if (rollButton) rollButton.disabled = !allowRollActions;
    if (fateModeToggle) fateModeToggle.disabled = isAnimating || isGlowingAndSpinning; // Can only toggle fate if not animating/glowing
    if (glowSpinToggleButton) glowSpinToggleButton.disabled = isAnimating; // Can only toggle glow if not animating

    if (modelSelect) modelSelect.disabled = !canInteract;
    if (themeSelect) themeSelect.disabled = !canInteract;
    if (sizeSlider) sizeSlider.disabled = !canInteract;
    if (wireframeToggleButton) wireframeToggleButton.disabled = !canInteract;
    if (resetViewButton) resetViewButton.disabled = !canInteract;
    if (ambientLightToggle) ambientLightToggle.disabled = !canInteract;
    if (directionalLightToggle) directionalLightToggle.disabled = !canInteract;
    if (musicToggleButton) musicToggleButton.disabled = !canInteract;

    if (controls) { controls.enabled = true; }
}

// --- Reset All Action States ---
function resetAllActionStates() {
    console.log("[Reset] Resetting all action states...");

    // Kill any active GSAP animations targeting the model parts
    if (modelParts.length > 0) {
        console.log("[Reset] Killing active GSAP tweens...");
        modelParts.forEach(part => gsap.killTweensOf(part.position));
        modelParts.forEach(part => gsap.killTweensOf(part.rotation));
        modelParts.forEach(part => gsap.killTweensOf(part.quaternion));
    }

    isAnimating = false; // Clear animation flag
    forceStopGlowAndSpin(); // Stop glow

    if (fateModeToggle && fateModeToggle.checked) { // Stop Fate Mode
        fateModeToggle.checked = false;
        if (fateIntervalId) { clearInterval(fateIntervalId); fateIntervalId = null; }
    }

    // Restore original positions/rotations IF they exist
    if (currentModel && modelParts.length > 0 && originalStates.size > 0) {
         console.log("[Reset] Restoring original part states...");
         modelParts.forEach(part => {
             const originalState = originalStates.get(part.uuid);
             if (originalState) {
                 part.position.copy(originalState.position);
                 part.quaternion.copy(originalState.quaternion);
             }
         });
         // Also ensure parent model is centered correctly (applyUserScale handles this)
         applyUserScale();

    } else if (currentModel) {
        // Fallback if parts/states weren't stored correctly
        console.warn("[Reset] No parts/states stored, resetting model position/rotation directly.");
         currentModel.position.set(0,0,0); // Fallback centering
         currentModel.rotation.set(0, 0, 0);
         applyUserScale(); // Attempt scale/center
    }


    removeParticles(); // Clear particles
    if (resultText) resultText.textContent = "-"; // Reset result display
    enableControls(); // Re-enable controls
    console.log(`[Reset] Finished.`);
}


// --- Event Listener Setup ---
function setupEventListeners() { // Keep mostly as is
     if (rollButton) rollButton.addEventListener('click', rollOrFlip); // Now triggers explode/reassemble
    if (wireframeToggleButton) wireframeToggleButton.addEventListener('click', () => applyWireframe());
    if (modelSelect) {
        modelSelect.addEventListener('change', (event) => {
            currentModelKey = event.target.value;
            const modelPath = getModelPath(currentModelKey);
            if (modelPath) { loadModel(modelPath); }
            else { console.error("[Event] Failed to get model path on select change."); }
            if (resultText) resultText.textContent = "-";
        });
    }
    if (themeSelect) themeSelect.addEventListener('change', (event) => changeTheme(event.target.value));
    if (fateModeToggle) fateModeToggle.addEventListener('change', toggleFateMode);
    if (ambientLightToggle) ambientLightToggle.addEventListener('click', toggleAmbientLight);
    if (directionalLightToggle) directionalLightToggle.addEventListener('click', toggleDirectionalLight);
    if (glowSpinToggleButton) glowSpinToggleButton.addEventListener('click', toggleGlowAndSpin);
    if (sizeSlider) sizeSlider.addEventListener('input', applyUserScale);
    if (musicToggleButton) musicToggleButton.addEventListener('click', toggleMusic);
    if (resetViewButton) resetViewButton.addEventListener('click', resetCameraView);
    window.addEventListener('resize', onWindowResize, false);
}

// --- Animation Loop ---
function animate() {
    try {
        requestAnimationFrame(animate);
        const deltaTime = clock.getDelta();

        // --- NO LONGER NEED updateAnimationState ---
        // updateAnimationState(deltaTime);

        // Update continuous glow spin rotation if active
        if (isGlowingAndSpinning && currentModel) {
            currentModel.rotation.y += 1.5 * deltaTime;
        }

        updateParticles(deltaTime); // Update particles

        if (controls && controls.enabled) { controls.update(); } // Update controls

        if (composer) { composer.render(); } // Render scene
        else if (renderer && scene && camera) { renderer.render(scene, camera); }

    } catch (error) {
        console.error("!!! FATAL ERROR in animation loop !!!", error);
    }
}

// --- Window Resize Handler ---
function onWindowResize() { // Keep as is
    if (!camera || !renderer || !composer || !sceneContainer) return;
    camera.aspect = sceneContainer.clientWidth / sceneContainer.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(sceneContainer.clientWidth, sceneContainer.clientHeight);
    composer.setSize(sceneContainer.clientWidth, sceneContainer.clientHeight);
}

// --- Start Application ---
if (document.readyState === 'loading') { // Keep as is
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
