/**
 * @fileoverview Uploader component with drag-and-drop, file browse,
 * and ZIP archive extraction support.
 *
 * Emits:
 *   'files-selected'  — detail: Array<{file: File|Blob, name: string}>
 *   'upload-error'    — detail: {message: string}
 *   'upload-progress' — detail: {status: string}
 */

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.bmp',
]);

const IMAGE_MIME_PREFIX = 'image/';

/**
 * Is this File (or filename) an image we can handle?
 */
function isImage(nameOrFile) {
  const name = typeof nameOrFile === 'string' ? nameOrFile : nameOrFile.name;
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Is this a ZIP file?
 */
function isZip(file) {
  if (file.type === 'application/zip' || file.type === 'application/x-zip-compressed') return true;
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  return ext === '.zip';
}

/**
 * Extract image files from a ZIP using JSZip (loaded globally).
 * @param {File} zipFile
 * @returns {Promise<Array<{file: Blob, name: string}>>}
 */
async function extractImagesFromZip(zipFile) {
  if (typeof JSZip === 'undefined') {
    throw new Error('JSZip library not loaded — ZIP support unavailable');
  }

  const zip = await JSZip.loadAsync(zipFile);
  const entries = [];

  zip.forEach((relativePath, zipEntry) => {
    if (zipEntry.dir) return;
    // Skip macOS resource forks and hidden files
    if (relativePath.startsWith('__MACOSX/') || relativePath.startsWith('.')) return;
    const basename = relativePath.split('/').pop();
    if (basename.startsWith('.')) return;
    if (isImage(basename)) {
      entries.push({ relativePath, zipEntry, basename });
    }
  });

  // Sort by name
  entries.sort((a, b) => a.basename.localeCompare(b.basename, undefined, { numeric: true }));

  // Extract in parallel (batch of 4 for memory)
  const results = [];
  const BATCH = 4;
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const blobs = await Promise.all(
      batch.map(async ({ zipEntry, basename }) => {
        const data = await zipEntry.async('blob');
        return { file: data, name: basename };
      })
    );
    results.push(...blobs);
  }
  return results;
}


export class Uploader extends EventTarget {
  /**
   * @param {HTMLElement} dropZoneEl
   * @param {HTMLInputElement} fileInputEl
   * @param {HTMLElement} browseBtn
   */
  constructor(dropZoneEl, fileInputEl, browseBtn) {
    super();
    this.dropZoneEl = dropZoneEl;
    this.fileInputEl = fileInputEl;
    this.browseBtn = browseBtn;

    this._initEvents();
  }

  _initEvents() {
    // Browse button click
    this.browseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.fileInputEl.click();
    });

    // File input change
    this.fileInputEl.addEventListener('change', (e) => {
      this._handleFiles(e.target.files);
      this.fileInputEl.value = '';
    });

    // Drag and drop
    this.dropZoneEl.addEventListener('dragenter', this._onDragIn.bind(this));
    this.dropZoneEl.addEventListener('dragleave', this._onDragOut.bind(this));
    this.dropZoneEl.addEventListener('dragover', this._onDragOver.bind(this));
    this.dropZoneEl.addEventListener('drop', this._onDrop.bind(this));
  }

  _onDragIn(e) { e.preventDefault(); e.stopPropagation(); this.dropZoneEl.classList.add('drag-over'); }
  _onDragOut(e) { e.preventDefault(); e.stopPropagation(); this.dropZoneEl.classList.remove('drag-over'); }
  _onDragOver(e) { e.preventDefault(); e.stopPropagation(); this.dropZoneEl.classList.add('drag-over'); }

  _onDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    this.dropZoneEl.classList.remove('drag-over');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      this._handleFiles(e.dataTransfer.files);
    }
  }

  /**
   * Handle a FileList from either drag-drop or file input.
   * Routes ZIP files to the extractor, image files directly to consumers.
   * @param {FileList} fileList
   */
  async _handleFiles(fileList) {
    const files = Array.from(fileList);

    // Check for ZIP files
    const zipFiles = files.filter(isZip);
    const imageFiles = files.filter(f => !isZip(f) && (f.type.startsWith(IMAGE_MIME_PREFIX) || isImage(f)));

    let allImages = imageFiles.map(f => ({ file: f, name: f.name }));

    // Extract ZIPs
    for (const zipFile of zipFiles) {
      try {
        this.dispatchEvent(new CustomEvent('upload-progress', {
          detail: { status: `Extracting ${zipFile.name}…` }
        }));
        const extracted = await extractImagesFromZip(zipFile);
        allImages = allImages.concat(extracted);
      } catch (err) {
        this.dispatchEvent(new CustomEvent('upload-error', {
          detail: { message: `Failed to extract ${zipFile.name}: ${err.message}` }
        }));
      }
    }

    if (allImages.length === 0) {
      if (zipFiles.length > 0) {
        this.dispatchEvent(new CustomEvent('upload-error', {
          detail: { message: 'ZIP file contained no supported images (JPEG, PNG, TIFF, WEBP)' }
        }));
      }
      return;
    }

    // Sort by name (with numeric awareness)
    allImages.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    this.dispatchEvent(new CustomEvent('files-selected', {
      detail: allImages
    }));
  }

  /**
   * Parses filename in MMDDYY_HHMM#NNN format.
   * @param {string} name
   * @returns {Object|null}
   */
  static parseFilename(name) {
    const regex = /^(\d{2})(\d{2})(\d{2})_(\d{2})(\d{2})(?:#(\w+))?/;
    const match = name.match(regex);

    if (!match) return null;

    const [_, mo, d, y, h, m, extra] = match;
    const year = parseInt(y, 10) + 2000;
    const month = parseInt(mo, 10) - 1;
    const day = parseInt(d, 10);
    const hour = parseInt(h, 10);
    const minute = parseInt(m, 10);

    const date = new Date(year, month, day, hour, minute);

    return {
      date,
      hours_offset: null,
      tray: extra || null,
      crop: null,
    };
  }
}
