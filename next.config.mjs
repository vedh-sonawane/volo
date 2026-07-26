/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["better-sqlite3", "nodemailer"],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
