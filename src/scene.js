import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * Scene manager - handles Three.js scene setup and rendering
 */
export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.backgroundColor = 0x2d2d2d;

    this.initScene();
    this.initCamera();
    this.initRenderer();
    this.initControls();
    this.initLights();
    this.initGrid();

    this.animate = this.animate.bind(this);
    this.handleResize = this.handleResize.bind(this);

    window.addEventListener('resize', this.handleResize);
    this.handleResize();
    this.animate();
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.backgroundColor);
  }

  initCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
    this.camera.position.set(0, 2, 5);
    this.camera.lookAt(0, 0, 0);
  }

  initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  initControls() {
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.enablePan = true;
    this.controls.enableZoom = true;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 50;

    // Touch settings for mobile
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN
    };
  }

  initLights() {
    // Ambient light for base illumination
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    // Directional light for depth
    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(5, 10, 5);
    this.scene.add(directional);

    // Secondary directional light from opposite side
    const directional2 = new THREE.DirectionalLight(0xffffff, 0.3);
    directional2.position.set(-5, 5, -5);
    this.scene.add(directional2);
  }

  initGrid() {
    // Ground grid helper
    this.grid = new THREE.GridHelper(10, 20, 0x444444, 0x333333);
    this.grid.position.y = -0.001; // Slightly below origin to avoid z-fighting
    this.scene.add(this.grid);

    // Axis helper (small, at origin)
    this.axisHelper = new THREE.AxesHelper(0.5);
    this.scene.add(this.axisHelper);
  }

  handleResize() {
    const container = this.canvas.parentElement;
    const width = container.clientWidth;
    const height = container.clientHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate() {
    requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Set background color
   * @param {string} hexColor - Hex color string (e.g., "#2d2d2d")
   */
  setBackgroundColor(hexColor) {
    const color = new THREE.Color(hexColor);
    this.scene.background = color;
    this.backgroundColor = color.getHex();
  }

  /**
   * Toggle grid visibility
   * @param {boolean} visible
   */
  setGridVisible(visible) {
    this.grid.visible = visible;
  }

  /**
   * Enable or disable orbit controls
   * @param {boolean} enabled
   */
  setControlsEnabled(enabled) {
    this.controls.enabled = enabled;
  }

  /**
   * Add object to scene
   * @param {THREE.Object3D} object
   */
  add(object) {
    this.scene.add(object);
  }

  /**
   * Remove object from scene
   * @param {THREE.Object3D} object
   */
  remove(object) {
    this.scene.remove(object);
  }

  /**
   * Reset camera to default position
   */
  resetCamera() {
    this.camera.position.set(0, 2, 5);
    this.camera.lookAt(0, 0, 0);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  /**
   * Get raycaster for mouse/touch picking
   * @param {number} x - Normalized device coordinate x (-1 to 1)
   * @param {number} y - Normalized device coordinate y (-1 to 1)
   * @returns {THREE.Raycaster}
   */
  getRaycaster(x, y) {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2(x, y);
    raycaster.setFromCamera(mouse, this.camera);
    return raycaster;
  }

  /**
   * Convert screen coordinates to normalized device coordinates
   * @param {number} screenX
   * @param {number} screenY
   * @returns {{x: number, y: number}}
   */
  screenToNDC(screenX, screenY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((screenX - rect.left) / rect.width) * 2 - 1,
      y: -((screenY - rect.top) / rect.height) * 2 + 1
    };
  }

  /**
   * Cleanup resources
   */
  dispose() {
    window.removeEventListener('resize', this.handleResize);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
