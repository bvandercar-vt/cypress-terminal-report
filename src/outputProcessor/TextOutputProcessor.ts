import BaseOutputProcessor, {IOutputProcecessor} from './BaseOutputProcessor';
import logsTxtFormatter from './logsTxtFormatter';
import {EOL} from 'os';
import type {AllMessages, PluginOptions} from '../installLogsPrinter.types';

const PADDING = '    ';

export default class TextOutputProcessor extends BaseOutputProcessor implements IOutputProcecessor {
  constructor(file: string, options: PluginOptions) {
    super(file, options);
    this.chunkSeparator = EOL + EOL;
  }

  write(allMessages: AllMessages) {
    Object.entries(allMessages).forEach(([spec, tests]) => {
      let text = `${spec}:${EOL}`;
      Object.entries(tests).forEach(([test, messages]) => {
        text += `${PADDING}${test}${EOL}`;
        text += logsTxtFormatter(messages, EOL);
        text += EOL;
      });

      this.writeSpecChunk(spec, text);
    });
  }
}
