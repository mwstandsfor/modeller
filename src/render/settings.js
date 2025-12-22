import * as THREE from 'three';

/**
 * Render Settings Manager
 * Manages visual rendering options like cavity shading and x-ray mode
 *
 * ============================================
 * SETTINGS - Easy to find and tweak!
 * ============================================
 */

// Cavity Settings
export const CAVITY_SETTINGS = {
  enabled: false,

  // Ridge (convex edges) - lighter color
  ridgeColor: new THREE.Color(1.0, 1.0, 1.0),  // White highlight
  ridgeStrength: 0.4,  // How much to lighten ridges (0-1)

  // Valley (concave edges) - darker color
  valleyColor: new THREE.Color(0.0, 0.0, 0.0),  // Black shadow
  valleyStrength: 0.5,  // How much to darken valleys (0-1)

  // Overall intensity
  intensity: 1.0,
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
 * Cavity shader - enhances edges based on curvature
 * Uses screen-space derivative of normals to detect edges
 */
export const CavityShader = {
  uniforms: {
    tDiffuse: { value: null },
    tNormal: { value: null },
    cavityStrength: { value: CAVITY_SETTINGS.intensity },
    ridgeStrength: { value: CAVITY_SETTINGS.ridgeStrength },
    valleyStrength: { value: CAVITY_SETTINGS.valleyStrength },
  },

  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float cavityStrength;
    uniform float ridgeStrength;
    uniform float valleyStrength;
    varying vec2 vUv;

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      gl_FragColor = color;
    }
  `
};

/**
 * Create a cavity-enhanced material from an existing material
 * @param {THREE.Material} baseMaterial - The original material
 * @returns {THREE.Material} - Enhanced material with cavity effect
 */
export function createCavityMaterial(baseMaterial) {
  if (!baseMaterial) return null;

  // Clone the material to avoid modifying the original
  const material = baseMaterial.clone();

  // Inject cavity shader code into the material
  material.onBeforeCompile = (shader) => {
    // Add uniforms
    shader.uniforms.cavityStrength = { value: CAVITY_SETTINGS.intensity };
    shader.uniforms.ridgeStrength = { value: CAVITY_SETTINGS.ridgeStrength };
    shader.uniforms.valleyStrength = { value: CAVITY_SETTINGS.valleyStrength };

    // Modify fragment shader to add cavity effect
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `
      #include <common>
      uniform float cavityStrength;
      uniform float ridgeStrength;
      uniform float valleyStrength;
      `
    );

    // Add cavity calculation after lighting
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `
      // Cavity effect using screen-space normal derivatives
      vec3 fdx = dFdx(vNormal);
      vec3 fdy = dFdy(vNormal);
      float cavity = length(fdx) + length(fdy);
      cavity = clamp(cavity * 10.0, 0.0, 1.0);

      // Apply cavity darkening
      float darken = 1.0 - (cavity * valleyStrength * cavityStrength);
      gl_FragColor.rgb *= darken;

      // Subtle ridge highlighting based on normal direction
      float ridge = dot(vNormal, vec3(0.0, 0.0, 1.0));
      ridge = max(0.0, ridge);
      gl_FragColor.rgb += ridge * ridgeStrength * cavityStrength * 0.1;

      #include <dithering_fragment>
      `
    );

    // Store shader reference for updates
    material.userData.shader = shader;
  };

  material.needsUpdate = true;
  return material;
}

/**
 * RenderSettings class - manages render mode state and applies to meshes
 */
export class RenderSettings {
  constructor() {
    this.cavityEnabled = CAVITY_SETTINGS.enabled;
    this.xrayEnabled = XRAY_SETTINGS.enabled;

    // Store original materials for restoration
    this.originalMaterials = new WeakMap();
    this.cavityMaterials = new WeakMap();

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

    // Restore original material
    const original = this.originalMaterials.get(mesh);
    if (original) {
      mesh.material = original;
    }

    this.meshes.delete(mesh);
    this.originalMaterials.delete(mesh);
    this.cavityMaterials.delete(mesh);
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

    // Apply X-Ray settings
    if (this.xrayEnabled) {
      material.transparent = true;
      material.opacity = XRAY_SETTINGS.opacity;
      material.depthWrite = XRAY_SETTINGS.depthWrite;
      material.side = XRAY_SETTINGS.showBackfaces ? THREE.DoubleSide : THREE.FrontSide;
    }

    // Apply Cavity settings
    if (this.cavityEnabled) {
      material = this.applyCavityEffect(material);
    }

    material.needsUpdate = true;
    mesh.material = material;
  }

  /**
   * Apply cavity effect to material
   * @param {THREE.Material} material
   * @returns {THREE.Material}
   */
  applyCavityEffect(material) {
    // For MeshBasicMaterial or materials without normals, skip cavity
    if (material.isMeshBasicMaterial) {
      return material;
    }

    // Use onBeforeCompile to inject cavity shader code
    material.onBeforeCompile = (shader) => {
      shader.uniforms.cavityStrength = { value: CAVITY_SETTINGS.intensity };
      shader.uniforms.valleyStrength = { value: CAVITY_SETTINGS.valleyStrength };
      shader.uniforms.ridgeStrength = { value: CAVITY_SETTINGS.ridgeStrength };

      // Add uniforms declaration
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `
        #include <common>
        uniform float cavityStrength;
        uniform float valleyStrength;
        uniform float ridgeStrength;
        `
      );

      // Add cavity calculation before output
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `
        // Cavity effect - darken based on normal variation
        vec3 fdx = dFdx(vNormal);
        vec3 fdy = dFdy(vNormal);
        float cavity = (length(fdx) + length(fdy)) * 8.0;
        cavity = clamp(cavity, 0.0, 1.0);

        // Darken valleys (high curvature areas)
        gl_FragColor.rgb *= 1.0 - (cavity * valleyStrength * cavityStrength);

        // Lighten ridges slightly
        float facing = max(0.0, dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)));
        gl_FragColor.rgb += facing * ridgeStrength * cavityStrength * 0.05;

        #include <dithering_fragment>
        `
      );

      material.userData.shader = shader;
    };

    return material;
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
   * Get current settings state
   */
  getState() {
    return {
      cavityEnabled: this.cavityEnabled,
      xrayEnabled: this.xrayEnabled,
      cavitySettings: { ...CAVITY_SETTINGS },
      xraySettings: { ...XRAY_SETTINGS },
    };
  }

  /**
   * Cleanup
   */
  dispose() {
    for (const mesh of this.meshes) {
      this.unregisterMesh(mesh);
    }
    this.meshes.clear();
  }
}
