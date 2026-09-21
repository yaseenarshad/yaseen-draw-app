/** Entry for `out/main/cli.js`: stdio in, exit code out. The program lives in `cli.ts` so it tests in-process. */
import { main } from './cli'

const stdin = async (): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

void main(process.argv.slice(2), { stdin, stdout: (t) => process.stdout.write(t), stderr: (t) => process.stderr.write(t) }).then((code) => {
  process.exitCode = code
})
