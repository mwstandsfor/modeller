import * as THREE from 'three';

/**
 * Create a textured plane from an image
 * The plane is sized to match the image aspect ratio
 */
export class ImagePlane {
  constructor() {
    this.mesh = null;
    this.texture = null;
    this.imageData = null;
    this.originalWidth = 0;
    this.originalHeight = 0;
  }

  /**
   * Load image and create textured plane
   * @param {File} file - Image file
   * @returns {Promise<THREE.Mesh>}
   */
  async loadFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        const img = new Image();

        img.onload = () => {
          this.originalWidth = img.width;
          this.originalHeight = img.height;
          this.imageData = e.target.result;

          // Create texture
          this.texture = new THREE.Texture(img);
          this.texture.needsUpdate = true;
          this.texture.colorSpace = THREE.SRGBColorSpace;

          // Calculate plane size (normalize to max 2 units)
          const maxSize = 2;
          const aspect = img.width / img.height;
          let width, height;

          if (aspect > 1) {
            width = maxSize;
            height = maxSize / aspect;
          } else {
            height = maxSize;
            width = maxSize * aspect;
          }

          // Create geometry
          const geometry = new THREE.PlaneGeometry(width, height, 1, 1);

          // Create material (double-sided so visible from back)
          const material = new THREE.MeshBasicMaterial({
            map: this.texture,
            side: THREE.DoubleSide
          });

          // Create mesh
          this.mesh = new THREE.Mesh(geometry, material);
          this.mesh.name = 'imagePlane';

          // Position at origin, centered on grid
          this.mesh.position.set(0, 0, 0);

          resolve(this.mesh);
        };

        img.onerror = () => {
          reject(new Error('Failed to load image'));
        };

        img.src = e.target.result;
      };

      reader.onerror = () => {
        reject(new Error('Failed to read file'));
      };

      reader.readAsDataURL(file);
    });
  }

  /**
   * Get plane dimensions
   * @returns {{width: number, height: number}}
   */
  getDimensions() {
    if (!this.mesh) return { width: 0, height: 0 };

    const geometry = this.mesh.geometry;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;

    return {
      width: box.max.x - box.min.x,
      height: box.max.y - box.min.y
    };
  }

  /**
   * Get original image dimensions
   * @returns {{width: number, height: number}}
   */
  getOriginalDimensions() {
    return {
      width: this.originalWidth,
      height: this.originalHeight
    };
  }

  /**
   * Get the image data URL
   * @returns {string|null}
   */
  getImageData() {
    return this.imageData;
  }

  /**
   * Dispose of resources
   */
  dispose() {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
    }
    if (this.texture) {
      this.texture.dispose();
    }
    this.mesh = null;
    this.texture = null;
    this.imageData = null;
  }
}
