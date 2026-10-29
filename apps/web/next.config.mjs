/** @type {import('next').NextConfig} */
const nextConfig = {
  // @ate/design and @ate/shared ship raw TS/TSX from the workspace,
  // so Next must transpile them rather than treat them as prebuilt deps.
  transpilePackages: ["@ate/design", "@ate/shared"],
  webpack: (config) => {
    // @ate/shared uses NodeNext ".js" specifiers on ".ts" source (so the
    // worker's Node runtime resolves them). Teach webpack to try ".ts" first
    // when it sees a ".js" import, so value imports from shared resolve.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
