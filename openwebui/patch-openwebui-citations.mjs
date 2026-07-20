import { readFileSync, writeFileSync } from 'node:fs';


const citationsFile = process.argv[2] ?? '/src/src/lib/components/chat/Messages/Citations.svelte';
let source = readFileSync(citationsFile, 'utf8');

function replaceExact(before, after, expected, description) {
	const occurrences = source.split(before).length - 1;
	if (occurrences !== expected) {
		throw new Error(
			`Patch incompatível com ${citationsFile}: esperado ${expected} trecho(s) para ${description}, encontrado ${occurrences}.`
		);
	}
	source = source.replaceAll(before, after);
}

replaceExact("\timport { embed, showControls, showEmbeds } from '$lib/stores';\n\n\timport CitationModal from './Citations/CitationModal.svelte';", "\timport { WEBUI_API_BASE_URL } from '$lib/constants';", 1, 'imports do modal');

replaceExact(
	`\n\tlet citationModal = null;\n\n\tlet showCitations = false;\n\tlet showCitationModal = false;\n\n\tlet selectedCitation: any = null;\n`,
	`\n\tlet showCitations = false;\n`,
	1,
	'estado do modal'
);

const modalHandler = `\texport const showSourceModal = (sourceId) => {
\t\tlet index;
\t\tlet suffix = null;

\t\tif (typeof sourceId === 'string') {
\t\t\tconst output = sourceId.split('#');
\t\t\tindex = parseInt(output[0]) - 1;

\t\t\tif (output.length > 1) {
\t\t\t\tsuffix = output[1];
\t\t\t}
\t\t} else {
\t\t\tindex = sourceId - 1;
\t\t}

\t\tif (citations[index]) {
\t\t\tconsole.log('Showing citation modal for:', citations[index]);

\t\t\tif (citations[index]?.source?.embed_url) {
\t\t\t\tconst embedUrl = citations[index].source.embed_url;
\t\t\t\tif (embedUrl) {
\t\t\t\t\tif (readOnly) {
\t\t\t\t\t\t// Open in new tab if readOnly
\t\t\t\t\t\twindow.open(embedUrl, '_blank');
\t\t\t\t\t\treturn;
\t\t\t\t\t} else {
\t\t\t\t\t\tshowControls.set(true);
\t\t\t\t\t\tshowEmbeds.set(true);
\t\t\t\t\t\tembed.set({
\t\t\t\t\t\t\turl: embedUrl,
\t\t\t\t\t\t\ttitle: citations[index]?.source?.name || 'Embedded Content',
\t\t\t\t\t\t\tsource: citations[index],
\t\t\t\t\t\t\tchatId: chatId,
\t\t\t\t\t\t\tmessageId: id,
\t\t\t\t\t\t\tsourceId: sourceId
\t\t\t\t\t\t});
\t\t\t\t\t}
\t\t\t\t} else {
\t\t\t\t\tselectedCitation = citations[index];
\t\t\t\t\tshowCitationModal = true;
\t\t\t\t}
\t\t\t} else {
\t\t\t\tselectedCitation = citations[index];
\t\t\t\tshowCitationModal = true;
\t\t\t}
\t\t}
\t};`;

const directHandler = `\tconst getCitationUrl = (citation: any): string | null => {
\t\tconst externalUrl = citation?.source?.url ?? citation?.source?.embed_url;
\t\tif (typeof externalUrl === 'string' && /^https?:\\/\\//.test(externalUrl)) {
\t\t\treturn externalUrl;
\t\t}

\t\tconst fileId = citation?.metadata?.find((metadata: any) => metadata?.file_id)?.file_id;
\t\treturn fileId ? \`\${WEBUI_API_BASE_URL}/files/\${encodeURIComponent(fileId)}/content\` : null;
\t};

\tconst openCitation = (citation: any) => {
\t\tconst url = getCitationUrl(citation);
\t\tif (!url) return;
\t\tconst opened = window.open(url, '_blank', 'noopener,noreferrer');
\t\tif (opened) opened.opener = null;
\t};

\texport const showSourceModal = (sourceId) => {
\t\tconst rawIndex = typeof sourceId === 'string' ? sourceId.split('#')[0] : sourceId;
\t\tconst index = Number.parseInt(String(rawIndex), 10) - 1;
\t\tif (citations[index]) openCitation(citations[index]);
\t};`;

replaceExact(modalHandler, directHandler, 1, 'abertura direta da citação');

replaceExact(
	`\t\t\t\tif (id.startsWith('http://') || id.startsWith('https://')) {
\t\t\t\t\t_source = { ..._source, name: id, url: id };
\t\t\t\t}`,
	`\t\t\t\tif (id.startsWith('http://') || id.startsWith('https://')) {
\t\t\t\t\t_source = { ..._source, name: metadata?.name ?? _source?.name ?? id, url: id };
\t\t\t\t}`,
	1,
	'nome original da fonte externa'
);

replaceExact(
	`\n<CitationModal
\tbind:show={showCitationModal}
\tcitation={selectedCitation}
\t{showPercentage}
\t{showRelevance}
/>\n`,
	'\n',
	1,
	'renderização do modal'
);

replaceExact(
	`\t\t\t\t\ton:click={() => {
\t\t\t\t\t\tshowCitationModal = true;
\t\t\t\t\t\tselectedCitation = citation;
\t\t\t\t\t}}`,
	`\t\t\t\t\ton:click={() => openCitation(citation)}`,
	1,
	'clique na lista de fontes'
);

writeFileSync(citationsFile, source);
