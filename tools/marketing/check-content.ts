import { loadContent } from "./src/content";

const { errors } = await loadContent();
for (const error of errors) console.error(error);
if (errors.length > 0) process.exit(1);
console.log("content OK");
