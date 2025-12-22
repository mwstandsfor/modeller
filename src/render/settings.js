import * as THREE from 'three';

/**
 * Render Settings Manager
 * Manages visual rendering options like cavity shading and x-ray mode
 *
 * ============================================
 * SETTINGS - Easy to find and tweak!
 * ============================================
 */

// Cavity Settings - uses edge wireframe overlay for reliable edge highlighting
export const CAVITY_SETTINGS = {
  enabled: false,

  // Edge line color (dark to show edges clearly)
  edgeColor: 0x000000,

  // Edge line opacity
  edgeOpacity: 0.3,

  // Threshold angle for edge detection (in degrees)
  // Lower = more edges shown, higher = only sharp edges
  thresholdAngle: 30,
};

// X-Ray Settings
export const XRAY_SETTINGS = {
  enabled: false,

  // Opacity when x-ray is on
  opacity: 0.5,

  // Whether to show backfaces
  showBackfaces: true,

  // Depth write (false = see-through)
  depthWrite: false,
};

/**
 * RenderSettings class - manages render mode state and applies to meshes
 */
export class RenderSettings {
  constructor() {
    this.cavityEnabled = CAVITY_SETTINGS.enabled;
    this.xrayEnabled = XRAY_SETTINGS.enabled;

    // Store original materials for restoration
    this.originalMaterials = new WeakMap();

    // Store cavity edge lines for each mesh
    this.cavityEdges = new WeakMap();

    // Reference to managed meshes
    this.meshes = new Set();
  }

  /**
   * Register a mesh to be affected by render settings
   * @param {THREE.Mesh} mesh
   */
  registerMesh(mesh) {
    if (!mesh || !mesh.material) return;

    this.meshes.add(mesh);

    // Store original material
    this.originalMaterials.set(mesh, mesh.material.clone());

    // Apply current settings
    this.applySettings(mesh);
  }

  /**
   * Unregister a mesh
   * @param {THREE.Mesh} mesh
   */
  unregisterMesh(mesh) {
    if (!mesh) return;

    // Remove cavity edges if present
    this.removeCavityEdges(mesh);

    // Restore original material
    const original = this.originalMaterials.get(mesh);
    if (original) {
      mesh.material = original;
    }

    this.meshes.delete(mesh);
    this.originalMaterials.delete(mesh);
  }

  /**
   * Toggle cavity rendering
   * @returns {boolean} New state
   */
  toggleCavity() {
    this.cavityEnabled = !this.cavityEnabled;
    CAVITY_SETTINGS.enabled = this.cavityEnabled;
    this.updateAllMeshes();
    return this.cavityEnabled;
  }

  /**
   * Toggle x-ray mode
   * @returns {boolean} New state
   */
  toggleXray() {
    this.xrayEnabled = !this.xrayEnabled;
    XRAY_SETTINGS.enabled = this.xrayEnabled;
    this.updateAllMeshes();
    return this.xrayEnabled;
  }

  /**
   * Update all registered meshes with current settings
   */
  updateAllMeshes() {
    for (const mesh of this.meshes) {
      this.applySettings(mesh);
    }
  }

  /**
   * Apply current render settings to a mesh
   * @param {THREE.Mesh} mesh
   */
  applySettings(mesh) {
    if (!mesh || !mesh.material) return;

    const original = this.originalMaterials.get(mesh);
    if (!original) return;

    // Start with a fresh clone of original
    let material = original.clone();

    // Apply Cavity - add edge wireframe overlay
    if (this.cavityEnabled) {
      this.addCavityEdges(mesh);
    } else {
      this.removeCavityEdges(mesh);
    }

    // Apply X-Ray settings
    if (this.xrayEnabled) {
      material.transparent = true;
      material.opacity = XRAY_SETTINGS.opacity;
      material.depthWrite = XRAY_SETTINGS.depthWrite;
      material.side = XRAY_SETTINGS.showBackfaces ? THREE.DoubleSide : THREE.FrontSide;
    }

    material.needsUpdate = true;
    mesh.material = material;
  }

  /**
   * Add cavity edge lines to a mesh
   * @param {THREE.Mesh} mesh
   */
  addCavityEdges(mesh) {
    // Remove existing edges first
    this.removeCavityEdges(mesh);

    if (!mesh.geometry) return;

    // Create edges geometry - detects edges based on angle threshold
    const thresholdAngle = CAVITY_SETTINGS.thresholdAngle;
    const edgesGeometry = new THREE.EdgesGeometry(mesh.geometry, thresholdAngle);

    // Create line material for edges
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: CAVITY_SETTINGS.edgeColor,
      transparent: true,
      opacity: CAVITY_SETTINGS.edgeOpacity,
      depthTest: true,
      depthWrite: false,
    });

    // Create line segments
    const edgeLines = new THREE.LineSegments(edgesGeometry, edgeMaterial);
    edgeLines.name = 'cavityEdges';

    // Add as child of mesh so it follows transformations
    mesh.add(edgeLines);

    // Store reference
    this.cavityEdges.set(mesh, edgeLines);
  }

  /**
   * Remove cavity edge lines from a mesh
   * @param {THREE.Mesh} mesh
   */
  removeCavityEdges(mesh) {
    const edges = this.cavityEdges.get(mesh);
    if (edges) {
      mesh.remove(edges);
      edges.geometry.dispose();
      edges.material.dispose();
      this.cavityEdges.delete(mesh);
    }
  }

  /**
   * Update cavity settings
   * @param {object} settings - Settings to update
   */
  updateCavitySettings(settings) {
    Object.assign(CAVITY_SETTINGS, settings);
    if (this.cavityEnabled) {
      this.updateAllMeshes();
    }
  }

  /**
   * Update x-ray settings
   * @param {object} settings - Settings to update
   */
  updateXraySettings(settings) {
    Object.assign(XRAY_SETTINGS, settings);
    if (this.xrayEnabled) {
      this.updateAllMeshes();
    }
  }

  /**
   * Get current cavity state
   * @returns {boolean}
   */
  isCavityEnabled() {
    return this.cavityEnabled;
  }

  /**
   * Get current x-ray state
   * @returns {boolean}
   */
  isXrayEnabled() {
    return this.xrayEnabled;
  }
}
