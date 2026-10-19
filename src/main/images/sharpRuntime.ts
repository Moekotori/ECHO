import sharp from 'sharp';

// Derivatives already have a disk cache. Do not retain libvips operation
// graphs, image memory or file handles after one-shot image jobs finish.
sharp.cache(false);

export default sharp;
