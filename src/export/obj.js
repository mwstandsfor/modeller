/**
 * OBJ file exporter
 * Exports the editable mesh to OBJ format with MTL and texture
 */

import JSZip from 'jszip';

/**
 * Export mesh to OBJ format
 * @param {EditableMesh} editableMesh
 * @param {string} name - Model name
 * @returns {{obj: string, mtl: string}}
 */
export function exportToOBJ(editableMesh, name = 'model') {
  const faces = editableMesh.faces;

  let objContent = `# ImageModel Export\n`;
  objContent += `# https://github.com/imagemodel\n`;
  objContent += `mtllib ${name}.mtl\n`;
  objContent += `o ${name}\n\n`;

  // Collect all vertices and UVs
  const vertices = [];
  const uvs = [];
  const faceIndices = [];

  let vertexIndex = 1; // OBJ indices start at 1
  let uvIndex = 1;

  for (const face of faces) {
    const faceVertIndices = [];
    const faceUVIndices = [];

    for (let i = 0; i < face.vertices.length; i++) {
      const v = face.vertices[i];
      const uv = face.uvs[i];

      vertices.push(v);
      uvs.push(uv);

      faceVertIndices.push(vertexIndex++);
      faceUVIndices.push(uvIndex++);
    }

    faceIndices.push({ verts: faceVertIndices, uvs: faceUVIndices });
  }

  // Write vertices
  objContent += `# Vertices: ${vertices.length}\n`;
  for (const v of vertices) {
    objContent += `v ${v.x.toFixed(6)} ${v.y.toFixed(6)} ${v.z.toFixed(6)}\n`;
  }
  objContent += '\n';

  // Write texture coordinates
  objContent += `# Texture coordinates: ${uvs.length}\n`;
  for (const uv of uvs) {
    objContent += `vt ${uv.x.toFixed(6)} ${uv.y.toFixed(6)}\n`;
  }
  objContent += '\n';

  // Calculate and write normals (one per face for flat shading)
  objContent += `# Normals: ${faces.length}\n`;
  for (const face of faces) {
    const n = face.normal;
    objContent += `vn ${n.x.toFixed(6)} ${n.y.toFixed(6)} ${n.z.toFixed(6)}\n`;
  }
  objContent += '\n';

  // Use material
  objContent += `usemtl ${name}_material\n\n`;

  // Write faces
  objContent += `# Faces: ${faces.length}\n`;
  let normalIndex = 1;
  for (const face of faceIndices) {
    // OBJ face format: f v1/vt1/vn1 v2/vt2/vn2 ...
    const faceStr = face.verts.map((v, i) => `${v}/${face.uvs[i]}/${normalIndex}`).join(' ');
    objContent += `f ${faceStr}\n`;
    normalIndex++;
  }

  // Create MTL content
  let mtlContent = `# ImageModel Material\n`;
  mtlContent += `newmtl ${name}_material\n`;
  mtlContent += `Ns 100.0\n`;          // Specular exponent
  mtlContent += `Ka 0.1 0.1 0.1\n`;    // Ambient color
  mtlContent += `Kd 0.8 0.8 0.8\n`;    // Diffuse color
  mtlContent += `Ks 0.2 0.2 0.2\n`;    // Specular color
  mtlContent += `Ni 1.0\n`;            // Optical density
  mtlContent += `d 1.0\n`;             // Dissolve (transparency)
  mtlContent += `illum 2\n`;           // Illumination model
  mtlContent += `map_Kd ${name}_texture.png\n`; // Diffuse texture map

  return { obj: objContent, mtl: mtlContent };
}

/**
 * Download files as a single zip archive
 * This works reliably on mobile/iPad where multiple downloads are blocked
 * @param {EditableMesh} editableMesh
 * @param {HTMLCanvasElement|string} textureSource - Texture canvas or data URL
 * @param {string} name - Export name
 */
export async function downloadOBJ(editableMesh, textureSource, name = 'model') {
  const { obj, mtl } = exportToOBJ(editableMesh, name);

  // Get texture as blob
  let textureBlob;
  if (textureSource instanceof HTMLCanvasElement) {
    textureBlob = await new Promise(resolve => textureSource.toBlob(resolve, 'image/png'));
  } else if (typeof textureSource === 'string') {
    // Data URL
    const response = await fetch(textureSource);
    textureBlob = await response.blob();
  }

  // Create zip file containing all export files
  const zip = new JSZip();

  // Add OBJ file
  zip.file(`${name}.obj`, obj);

  // Add MTL file
  zip.file(`${name}.mtl`, mtl);

  // Add texture
  if (textureBlob) {
    zip.file(`${name}_texture.png`, textureBlob);
  }

  // Generate zip and download
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(`${name}.zip`, zipBlob);
}

/**
 * Helper to download a text file
 */
function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  downloadBlob(filename, blob);
}

/**
 * Helper to download a blob
 * Note: On iOS, there's a confirmation dialog before download starts,
 * so we delay revoking the URL to ensure the download completes
 */
function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Delay URL cleanup to allow iOS Safari time to complete download
  // iOS shows a confirmation dialog, so the download doesn't start immediately
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60000); // 60 seconds - plenty of time for user to confirm and download
}

/**
 * Export to single GLTF/GLB (future enhancement)
 * For now, just stub
 */
export function exportToGLTF(editableMesh, texture) {
  console.warn('GLTF export not yet implemented');
  return null;
}
