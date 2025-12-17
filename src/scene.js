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
    this.camera.position.set(0, 0, 3);
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
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 50;

    // Mouse button configuration:
    // LEFT = rotate, MIDDLE = pan, RIGHT = pan
    // Scroll wheel = zoom (default OrbitControls behavior)
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN
    };

    // Touch settings for mobile
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN
    };

    // Pan settings
    this.controls.panSpeed = 1.0;
    this.controls.screenSpacePanning = true; // Pan parallel to screen
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



    // Create axis gizmo for corner display
    this.createAxisGizmo();
    
    // Grid aligned with XY plane (same as image plane)
    this.grid = new THREE.GridHelper(10, 100, 0x444444, 0x333333);
    // Rotate to XY plane (default is XZ)
    this.grid.rotation.x = Math.PI / 2;
    this.grid.position.z = -0.001; // Slightly behind origin to avoid z-fighting
    this.scene.add(this.grid);

    // Create custom axis lines (thicker than default)
    this.createAxisHelper();

  }

  
  /**
   * Create thick axis lines at origin
   */
  createAxisHelper() {
    const size = 1;

    // Colors matching the Figma design
    const colors = {
      x: { main: 0xEA1941, dark: 0x570011 },  // Red
      y: { main: 0x629600, dark: 0x1E2F00 },  // Green
      z: { main: 0x2870DF, dark: 0x002763 }   // Blue
    };

    // X axis - Red
    const xGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(size, 0, 0)
    ]);
    const xMat = new THREE.LineBasicMaterial({ color: colors.x.main, linewidth: 3 });
    this.axisX = new THREE.Line(xGeom, xMat);

    // Y axis - Green
    const yGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, size, 0)
    ]);
    const yMat = new THREE.LineBasicMaterial({ color: colors.y.main, linewidth: 3 });
    this.axisY = new THREE.Line(yGeom, yMat);

    // Z axis - Blue
    const zGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, size)
    ]);
    const zMat = new THREE.LineBasicMaterial({ color: colors.z.main, linewidth: 3 });
    this.axisZ = new THREE.Line(zGeom, zMat);

    this.scene.add(this.axisX);
    this.scene.add(this.axisY);
    this.scene.add(this.axisZ);
  }


  /**
   * Create axis orientation gizmo (renders in corner)
   * Design: colored circles with axis letters, connected by lines
   */
  createAxisGizmo() {
    // Create a separate scene for the gizmo
    this.gizmoScene = new THREE.Scene();

    // Create gizmo camera
    this.gizmoCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
    this.gizmoCamera.position.set(0, 0, 5);

    const lineLength = 0.6;

    // Colors matching the Figma design
    const colors = {
      x: { main: 0xEA1941, dark: 0x570011 },  // Red
      y: { main: 0x629600, dark: 0x1E2F00 },  // Green
      z: { main: 0x2870DF, dark: 0x002763 }   // Blue
    };

    // X axis line
    const xLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(lineLength, 0, 0)
      ]),
      new THREE.LineBasicMaterial({ color: colors.x.main, linewidth: 10 })
    );
    this.gizmoScene.add(xLine);

    // Y axis line
    const yLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, lineLength, 0)
      ]),
      new THREE.LineBasicMaterial({ color: colors.y.main, linewidth: 10 })
    );
    this.gizmoScene.add(yLine);

    // Z axis line
    const zLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, lineLength)
      ]),
      new THREE.LineBasicMaterial({ color: colors.z.main, linewidth: 10 })
    );
    this.gizmoScene.add(zLine);

    // Create circle labels at end of each axis
    this.createGizmoCircle('X', new THREE.Vector3(lineLength + 0.15, 0, 0), colors.x);
    this.createGizmoCircle('Y', new THREE.Vector3(0, lineLength + 0.15, 0), colors.y);
    this.createGizmoCircle('Z', new THREE.Vector3(0, 0, lineLength + 0.15), colors.z);
  }

  /**
   * Create a circular label with letter for the gizmo
   */
  createGizmoCircle(text, position, colors) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    // Draw filled circle
    ctx.beginPath();
    ctx.arc(32, 32, 28, 0, Math.PI * 2);
    ctx.fillStyle = '#' + colors.main.toString(16).padStart(6, '0');
    ctx.fill();

    // Draw letter
    ctx.fillStyle = '#' + colors.dark.toString(16).padStart(6, '0');
    ctx.font = 'bold 32px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 32, 34);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(0.35, 0.35, 1);
    this.gizmoScene.add(sprite);
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

    // Render main scene
    this.renderer.render(this.scene, this.camera);

    // Render axis gizmo in corner
    this.renderGizmo();
  }

  /**
   * Render the axis gizmo in the bottom-right corner
   */
  renderGizmo() {
    if (!this.gizmoScene || !this.gizmoCamera) return;

    // Sync gizmo camera rotation with main camera
    this.gizmoCamera.position.set(0, 0, 3);
    this.gizmoCamera.position.applyQuaternion(this.camera.quaternion);
    this.gizmoCamera.lookAt(0, 0, 0);

    // Set viewport for gizmo (bottom-right corner)
    const gizmoSize = 100;
    const margin = 8;
    const container = this.canvas.parentElement;
    const gizmoX = container.clientWidth - gizmoSize - margin;


    // Preserve the current auto-clear state
    const oldAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;

    // set viewport & scissor for the gizmo
    this.renderer.setViewport(
      gizmoX,
      margin,
      gizmoSize,
      gizmoSize
    );
    this.renderer.setScissor(
      gizmoX,
      margin,
      gizmoSize,
      gizmoSize
    );
    this.renderer.setScissorTest(true);

    // clear the depth buffer so the gizmo is not occluded by grid
    this.renderer.clearDepth();
    this.renderer.render(this.gizmoScene, this.gizmoCamera);

    // Restore state
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, container.clientWidth, container.clientHeight);
    this.renderer.autoClear = oldAutoClear;
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
   * Reset camera to default position (front view of XY plane)
   */
  resetCamera() {
    // Position camera in front of the XY plane, looking at origin
    this.camera.position.set(0, 0, 3);
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
