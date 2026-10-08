// The bundler turns an imported image into the URL of its copy in dist/.
declare module '*.png' {
  const url: string;
  export default url;
}
