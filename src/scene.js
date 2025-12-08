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
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 50;

    // Mouse button configuration:
    // LEFT = rotate, MIDDLE = pan, RIGHT = zoom
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.DOLLY
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
    // Grid aligned with XY plane (same as image plane)
    this.grid = new THREE.GridHelper(10, 20, 0x444444, 0x333333);
    // Rotate to XY plane (default is XZ)
    this.grid.rotation.x = Math.PI / 2;
    this.grid.position.z = -0.001; // Slightly behind origin to avoid z-fighting
    this.scene.add(this.grid);

    // Create custom axis lines (thicker than default)
    this.createAxisHelper();

    // Create axis gizmo for corner display
    this.createAxisGizmo();
  }

  /**
   * Create thick axis lines at origin
   */
  createAxisHelper() {
    const size = 1;

    // X axis - Red
    const xGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(size, 0, 0)
    ]);
    const xMat = new THREE.LineBasicMaterial({ color: 0xff4444, linewidth: 3 });
    this.axisX = new THREE.Line(xGeom, xMat);

    // Y axis - Green
    const yGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, size, 0)
    ]);
    const yMat = new THREE.LineBasicMaterial({ color: 0x44ff44, linewidth: 3 });
    this.axisY = new THREE.Line(yGeom, yMat);

    // Z axis - Blue
    const zGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, size)
    ]);
    const zMat = new THREE.LineBasicMaterial({ color: 0x4444ff, linewidth: 3 });
    this.axisZ = new THREE.Line(zGeom, zMat);

    this.scene.add(this.axisX);
    this.scene.add(this.axisY);
    this.scene.add(this.axisZ);
  }

  /**
   * Create axis orientation gizmo (renders in corner)
   */
  createAxisGizmo() {
    // Create a separate scene for the gizmo
    this.gizmoScene = new THREE.Scene();

    // Create gizmo camera
    this.gizmoCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
    this.gizmoCamera.position.set(0, 0, 3);

    const gizmoSize = 0.8;

    // X axis - Red cone + line
    const xGroup = new THREE.Group();
    const xLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(gizmoSize, 0, 0)
      ]),
      new THREE.LineBasicMaterial({ color: 0xff4444, linewidth: 2 })
    );
    const xCone = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.2, 8),
      new THREE.MeshBasicMaterial({ color: 0xff4444 })
    );
    xCone.position.set(gizmoSize, 0, 0);
    xCone.rotation.z = -Math.PI / 2;
    xGroup.add(xLine, xCone);
    this.gizmoScene.add(xGroup);

    // Y axis - Green
    const yGroup = new THREE.Group();
    const yLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, gizmoSize, 0)
      ]),
      new THREE.LineBasicMaterial({ color: 0x44ff44, linewidth: 2 })
    );
    const yCone = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.2, 8),
      new THREE.MeshBasicMaterial({ color: 0x44ff44 })
    );
    yCone.position.set(0, gizmoSize, 0);
    yGroup.add(yLine, yCone);
    this.gizmoScene.add(yGroup);

    // Z axis - Blue
    const zGroup = new THREE.Group();
    const zLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, gizmoSize)
      ]),
      new THREE.LineBasicMaterial({ color: 0x4444ff, linewidth: 2 })
    );
    const zCone = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.2, 8),
      new THREE.MeshBasicMaterial({ color: 0x4444ff })
    );
    zCone.position.set(0, 0, gizmoSize);
    zCone.rotation.x = Math.PI / 2;
    zGroup.add(zLine, zCone);
    this.gizmoScene.add(zGroup);

    // Labels
    this.createGizmoLabel('X', new THREE.Vector3(gizmoSize + 0.2, 0, 0), 0xff4444);
    this.createGizmoLabel('Y', new THREE.Vector3(0, gizmoSize + 0.2, 0), 0x44ff44);
    this.createGizmoLabel('Z', new THREE.Vector3(0, 0, gizmoSize + 0.2), 0x4444ff);
  }

  /**
   * Create a text label for the gizmo
   */
  createGizmoLabel(text, position, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.font = 'bold 48px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 32, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(0.3, 0.3, 1);
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
   * Render the axis gizmo in the bottom-left corner
   */
  renderGizmo() {
    if (!this.gizmoScene || !this.gizmoCamera) return;

    // Sync gizmo camera rotation with main camera
    this.gizmoCamera.position.set(0, 0, 3);
    this.gizmoCamera.position.applyQuaternion(this.camera.quaternion);
    this.gizmoCamera.lookAt(0, 0, 0);

    // Set viewport for gizmo (bottom-left corner)
    const gizmoSize = 120;
    const margin = 10;

    // Save current state
    this.renderer.setViewport(
      margin,
      margin,
      gizmoSize,
      gizmoSize
    );
    this.renderer.setScissor(
      margin,
      margin,
      gizmoSize,
      gizmoSize
    );
    this.renderer.setScissorTest(true);

    // Clear and render gizmo
    this.renderer.setClearColor(0x1a1a1a, 0.8);
    this.renderer.clear();
    this.renderer.render(this.gizmoScene, this.gizmoCamera);

    // Restore full viewport
    this.renderer.setScissorTest(false);
    const container = this.canvas.parentElement;
    this.renderer.setViewport(0, 0, container.clientWidth, container.clientHeight);
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
    this.camera.position.set(0, 0, 4);
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
