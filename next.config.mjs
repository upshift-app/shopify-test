/** @type {import('next').NextConfig} */
export default {
  // The invoice PDF embeds DejaVu Sans (covers Lithuanian letters); make sure Vercel ships the font file.
  outputFileTracingIncludes: {
    '/**': ['./node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf', './node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf'],
  },
  serverExternalPackages: ['pdf-lib', '@pdf-lib/fontkit'],
};
