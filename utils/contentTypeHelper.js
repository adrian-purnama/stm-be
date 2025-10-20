/**
 * Helper function to determine content type based on file extension
 * @param {string} filename - The filename to determine content type for
 * @returns {string} The MIME type for the file
 */
function getContentType(filename) {
  const ext = filename.toLowerCase().split('.').pop();
  
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'dwg':
      return 'application/dwg';
    case 'dxf':
      return 'application/dxf';
    default:
      return 'application/octet-stream';
  }
}

module.exports = {
  getContentType
};
