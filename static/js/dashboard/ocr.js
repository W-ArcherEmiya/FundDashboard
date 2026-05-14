(() => {
    const app = window.FundDashboard = window.FundDashboard || {};
    const FUND_CODE_SEARCH_URL = 'https://fund.eastmoney.com/js/fundcode_search.js';
    const FUND_NAME_ALIASES = {
        天弘安康混合E: '013938',
        博时恒泽混合C: '011096',
        中欧颐利债券C: '016851',
        安信新价值灵活配置混合C: '003027',
        华夏新锦绣灵活配置混合C: '002834',
        诺安汇利灵活配置混合E: '022851'
    };
    const KNOWN_FUND_BRANDS = [
        '广发', '招商', '中航', '嘉实', '工银', '兴业', '万家', '天弘', '银华',
        '易方达', '华夏', '南方', '博时', '富国', '鹏华', '汇添富', '国泰',
        '华安', '景顺长城', '交银施罗德', '大成', '建信', '农银汇理', '诺安',
        '长城', '长信', '国投瑞银', '摩根', '平安', '中欧', '东方红', '海富通',
        '安信', '泓德', '永赢', '兴银', '银河', '华宝', '宝盈', '中银', '兴证全球',
        '浦银安盛', '上银', '西部利得', '前海开源', '财通', '华泰柏瑞', '中加',
        '民生加银', '中信保诚', '天治', '东吴', '光大保德信', '中邮'
    ];
    let fundCatalogPromise = null;

    function normalizeNumber(value) {
        if (!value) return '';
        const normalized = String(value)
            .replace(/[，,]/g, '')
            .replace(/[^\d.-]/g, '');
        const number = Number(normalized);
        return Number.isFinite(number) ? String(number) : '';
    }

    function extractCode(text) {
        const labeledCode = text.match(/(?:基金代码|产品代码|代码)\D{0,12}(\d{6})(?!\d)/);
        if (labeledCode) return labeledCode[1];

        const matches = [...text.matchAll(/(?:^|[^\d])(?!20\d{4})(\d{6})(?!\d)/g)]
            .map(match => match[1]);
        return matches[0] || '';
    }

    function extractNumberAfter(text, labels) {
        for (const label of labels) {
            const index = text.indexOf(label);
            if (index === -1) continue;

            const slice = text.slice(index + label.length, index + label.length + 80);
            const match = slice.match(/\d[\d,，]*(?:\.\d+)?/);
            const number = normalizeNumber(match && match[0]);
            if (number) return number;
        }
        return '';
    }

    function normalizeOcrText(rawText) {
        return String(rawText || '')
            .replace(/[：﹕]/g, ':')
            .replace(/[（）]/g, match => match === '（' ? '(' : ')')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function looksLikeHoldingsList(text) {
        return /我的持有/.test(text) &&
            /金额\s*\/?\s*昨日收益/.test(text) &&
            /持有收益\s*\/?\s*率/.test(text);
    }

    function hasDetailFields(text) {
        return /基金代码|产品代码|持有份额|持仓份额|持仓成本价|持有成本价|成本价/.test(text);
    }

    function stripKnownNoise(text) {
        return text
            .replace(/基金市场|机会|自选|持有/g, ' ')
            .replace(/全部|偏股|偏债|指数|黄金|持有收益排序/g, ' ')
            .replace(/今日收益更新/g, ' ')
            .replace(/投资锦囊|产品季报|基金财富号/g, ' ')
            .replace(/定投|金选|指数基金/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeFundName(value) {
        return String(value || '')
            .toUpperCase()
            .replace(/[Ａ-Ｚ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
            .replace(/[ЕΕ]/g, 'E')
            .replace(/温合/g, '混合')
            .replace(/(混合|债券|股票|指数|联接|配置|主题)([ABCDEIY])[A-Z]{2,}$/i, '$1$2')
            .replace(/(混合|债券|股票|指数|联接|配置|主题)G$/i, '$1C')
            .replace(/\.\.\.|…/g, '')
            .replace(/[·\s,，。:：;；、（）()[\]【】<>《》\-_/]/g, '')
            .replace(/基金财富号|今日收益更新|金选|定投|指数基金/g, '');
    }

    function splitNameTokens(normalizedName) {
        return normalizedName
            .replace(/(A|B|C|D|E|I|Y)$/i, '')
            .replace(/(QDII|FOF)/g, '')
            .split(/(?=\d)|(?<=[\dA-Z])(?=[\u4e00-\u9fa5])|(?<=[\u4e00-\u9fa5])(?=[A-Z\d])/)
            .map(token => token.replace(/联接$/, ''))
            .filter(token => token.length >= 2);
    }

    function getNameMatchScore(normalizedText, fundName) {
        if (!fundName || fundName.length < 4) return 0;
        if (normalizedText.includes(fundName)) return 120 + Math.min(fundName.length, 30);

        const shortName = fundName
            .replace(/(A|B|C|D|E|I|Y)$/i, '')
            .replace(/(QDII|FOF)/g, '');
        if (shortName.length >= 4 && normalizedText.includes(shortName)) {
            return 105 + Math.min(shortName.length, 25);
        }

        const tokens = splitNameTokens(fundName);
        let score = 0;
        let hitCount = 0;

        tokens.forEach(token => {
            if (normalizedText.includes(token)) {
                hitCount += 1;
                score += Math.min(token.length, 12) * 8;
                return;
            }

            if (token.length >= 5) {
                const prefix = token.slice(0, Math.min(token.length, 6));
                if (normalizedText.includes(prefix)) {
                    hitCount += 0.65;
                    score += prefix.length * 5;
                }
            }
        });

        const leading = fundName.slice(0, Math.min(fundName.length, 6));
        if (leading.length >= 4 && normalizedText.includes(leading)) score += 18;

        if (hitCount >= 2) return score;
        if (hitCount >= 1 && score >= 50) return score;
        return 0;
    }

    function loadFundCatalog() {
        if (fundCatalogPromise) return fundCatalogPromise;

        fundCatalogPromise = new Promise((resolve, reject) => {
            const previous = window.r;
            const script = document.createElement('script');
            script.async = true;
            script.src = `${FUND_CODE_SEARCH_URL}?rt=${Date.now()}`;

            script.onload = () => {
                const rawList = Array.isArray(window.r) ? window.r : [];
                const catalog = rawList
                    .filter(item => Array.isArray(item) && item[0] && item[2])
                    .map(item => ({
                        code: String(item[0]),
                        name: String(item[2]),
                        type: String(item[3] || ''),
                        normalizedName: normalizeFundName(item[2])
                    }));

                if (previous === undefined) delete window.r;
                else window.r = previous;
                if (script.parentNode) script.parentNode.removeChild(script);

                if (catalog.length === 0) reject(new Error('基金代码表为空'));
                else resolve(catalog);
            };

            script.onerror = () => {
                if (script.parentNode) script.parentNode.removeChild(script);
                reject(new Error('基金代码表加载失败'));
            };

            document.head.appendChild(script);
        });

        return fundCatalogPromise;
    }

    function findFundCandidates(text, catalog, ocrBlocks) {
        const structuredRows = extractHoldingRowsFromBlocks(ocrBlocks);
        if (structuredRows.length > 0) {
            const structuredCandidates = findCandidatesFromHoldingRows(structuredRows, catalog);
            if (structuredCandidates.every(candidate => candidate.code)) return structuredCandidates;

            const fallbackRows = extractHoldingRows(text);
            const fallbackCandidates = fallbackRows.length > 0 ? findCandidatesFromHoldingRows(fallbackRows, catalog) : [];
            return mergeLayoutAndTextCandidates(structuredCandidates, fallbackCandidates);
        }

        const rows = extractHoldingRows(text);
        if (rows.length > 0) {
            return findCandidatesFromHoldingRows(rows, catalog);
        }

        const normalizedText = normalizeFundName(text);
        if (!normalizedText) return [];

        const matches = [];
        catalog.forEach(fund => {
            const name = fund.normalizedName;
            if (name.length < 4) return;

            const score = getNameMatchScore(normalizedText, name);

            if (score > 0) {
                matches.push({
                    ...fund,
                    score,
                    ...extractHoldingMetricsForFund(text, normalizedText, fund)
                });
            }
        });

        const deduped = new Map();
        matches
            .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code))
            .forEach(match => {
                if (!deduped.has(match.code)) deduped.set(match.code, match);
            });

        const candidates = filterVariantCandidates(Array.from(deduped.values()), normalizedText)
            .slice(0, 8)
            .map(({ code, name, type, amount, holdProfit }) => ({ code, name, type, amount, holdProfit }));
        return appendUnmatchedHoldingRows(text, candidates);
    }

    function mergeLayoutAndTextCandidates(layoutCandidates, textCandidates) {
        if (!Array.isArray(textCandidates) || textCandidates.length === 0) return layoutCandidates;

        return layoutCandidates.map(candidate => {
            if (candidate.code) return candidate;
            const replacement = textCandidates.find(item =>
                Math.abs(Number(item.amount) - Number(candidate.amount)) < 0.01 &&
                Math.abs(Number(item.holdProfit) - Number(candidate.holdProfit)) < 0.01
            );
            if (!replacement) return candidate;
            if (replacement.code) return replacement;
            if ((replacement.suggestions || []).length > (candidate.suggestions || []).length) {
                return {
                    ...candidate,
                    suggestions: replacement.suggestions
                };
            }
            return candidate;
        });
    }

    function findCandidatesFromHoldingRows(rows, catalog) {
        return rows.map((row, index) => {
            const match = findBestCatalogMatchForRow(row, catalog);
            if (!match) {
                return {
                    code: '',
                    name: row.name || `无法匹配基金 ${index + 1}`,
                    type: '',
                    amount: row.amount,
                    holdProfit: row.holdProfit,
                    suggestions: row.suggestions || [],
                    unmatched: true
                };
            }

            if (match.ambiguous) {
                return {
                    code: '',
                    name: row.name || `无法匹配基金 ${index + 1}`,
                    type: '',
                    amount: row.amount,
                    holdProfit: row.holdProfit,
                    suggestions: match.suggestions,
                    unmatched: true
                };
            }

            return {
                code: match.code,
                name: match.name,
                type: match.type,
                amount: row.amount,
                holdProfit: row.holdProfit
            };
        });
    }

    function findBestCatalogMatchForRow(row, catalog) {
        const rowName = normalizeFundName(row.name);
        if (!rowName || rowName.length < 5) return null;

        const aliasCode = FUND_NAME_ALIASES[rowName];
        if (aliasCode) {
            return catalog.find(fund => fund.code === aliasCode) || null;
        }

        const compactAliasCode = FUND_NAME_ALIASES[compactIndustryAlias(rowName)];
        if (compactAliasCode) {
            return catalog.find(fund => fund.code === compactAliasCode) || null;
        }

        if (row.truncated) return null;

        const matches = catalog
            .map(fund => ({
                ...fund,
                score: getRowMatchScore(rowName, fund.normalizedName)
            }))
            .filter(fund => fund.score > 0)
            .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));

        if (matches.length === 0) return null;

        const bestScore = matches[0].score;
        const topMatches = matches.filter(match => match.score === bestScore);
        if (topMatches.length === 1) return topMatches[0];

        const rowClass = getVariantClass(rowName);
        if (rowClass) {
            const classMatches = topMatches.filter(match => getVariantClass(match.normalizedName) === rowClass);
            if (classMatches.length === 1) return classMatches[0];
            if (classMatches.length > 1) return buildAmbiguousMatch(classMatches);
        }

        return buildAmbiguousMatch(topMatches);
    }

    function normalizeOcrBlock(block) {
        if (!block || !block.text) return null;
        const left = Number(block.left);
        const top = Number(block.top);
        const right = Number(block.right);
        const bottom = Number(block.bottom);
        if (![left, top, right, bottom].every(Number.isFinite)) return null;

        return {
            text: String(block.text || '').trim(),
            left,
            top,
            right,
            bottom,
            width: right - left,
            height: bottom - top,
            cx: Number.isFinite(Number(block.cx)) ? Number(block.cx) : (left + right) / 2,
            cy: Number.isFinite(Number(block.cy)) ? Number(block.cy) : (top + bottom) / 2,
            score: Number(block.score)
        };
    }

    function extractHoldingRowsFromBlocks(rawBlocks) {
        const blocks = (Array.isArray(rawBlocks) ? rawBlocks : [])
            .map(normalizeOcrBlock)
            .filter(Boolean)
            .filter(block => block.text);
        if (blocks.length < 8) return [];

        const nameHeader = findBlockByText(blocks, /^名称$/);
        const amountHeader = findBlockByText(blocks, /金额\s*\/?\s*昨日收益/);
        const profitHeader = findBlockByText(blocks, /持有收益\s*\/?\s*率/);
        if (!amountHeader || !profitHeader) return [];

        const headerBottom = Math.max(
            nameHeader ? nameHeader.bottom : 0,
            amountHeader.bottom,
            profitHeader.bottom
        );
        const maxRight = Math.max(...blocks.map(block => block.right));
        const leftColumnRight = amountHeader.left - 18;
        const middleColumnLeft = amountHeader.left - Math.max(80, maxRight * 0.06);
        const middleColumnRight = profitHeader.left - Math.max(35, maxRight * 0.03);
        const rightColumnLeft = profitHeader.left - Math.max(45, maxRight * 0.04);

        const contentBlocks = blocks
            .filter(block => block.cy > headerBottom + 8)
            .filter(block => !isCoordinateNoiseText(block.text));
        const amountBlocks = contentBlocks
            .filter(block => block.cx >= middleColumnLeft && block.cx < middleColumnRight)
            .filter(block => isAmountAnchorText(block.text))
            .sort((a, b) => a.cy - b.cy);
        if (amountBlocks.length === 0) return [];

        const rows = [];
        amountBlocks.forEach((amountBlock, index) => {
            const previous = amountBlocks[index - 1];
            const next = amountBlocks[index + 1];
            const rowStart = previous ? (previous.cy + amountBlock.cy) / 2 : headerBottom;
            const rowEnd = next ? (amountBlock.cy + next.cy) / 2 : amountBlock.cy + estimateRowHeight(amountBlocks, index);
            const rowBlocks = contentBlocks.filter(block => block.cy >= rowStart && block.cy < rowEnd);

            const name = repairTruncatedFundName(cleanHoldingNameFragment(
                rowBlocks
                    .filter(block => block.cx < leftColumnRight)
                    .filter(block => isLikelyCoordinateNameText(block.text))
                    .sort((a, b) => a.top - b.top || a.left - b.left)
                    .map(block => block.text)
                    .join(''),
                false
            ));
            if (!isLikelyHoldingName(name)) return;

            const holdProfitBlock = rowBlocks
                .filter(block => block.cx >= rightColumnLeft)
                .filter(block => isSignedNumberText(block.text) && !isPercentText(block.text))
                .sort((a, b) => Math.abs(a.cy - amountBlock.cy) - Math.abs(b.cy - amountBlock.cy))[0];
            const holdProfit = normalizeNumber(holdProfitBlock && holdProfitBlock.text);
            if (!holdProfit) return;

            rows.push({
                name,
                truncated: /\.\.\.|…/.test(name),
                amount: normalizeNumber(amountBlock.text),
                holdProfit,
                index: amountBlock.top,
                end: rowEnd,
                source: 'layout'
            });
        });

        return rows.length >= 1 ? rows : [];
    }

    function findBlockByText(blocks, pattern) {
        return blocks.find(block => pattern.test(block.text));
    }

    function estimateRowHeight(amountBlocks, index) {
        const gaps = amountBlocks
            .slice(1)
            .map((block, blockIndex) => block.cy - amountBlocks[blockIndex].cy)
            .filter(gap => Number.isFinite(gap) && gap > 80);
        const sorted = gaps.slice().sort((a, b) => a - b);
        const medianGap = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 260;
        return Math.max(150, Math.min(360, medianGap * 0.58));
    }

    function isAmountAnchorText(text) {
        if (!/^\d[\d,，]*(?:\.\d{2})?$/.test(String(text || '').trim())) return false;
        const amount = Number(normalizeNumber(text));
        return Number.isFinite(amount) && amount >= 1;
    }

    function isSignedNumberText(text) {
        return /^[+-]\d[\d,，]*(?:\.\d+)?$/.test(String(text || '').trim());
    }

    function isPercentText(text) {
        return /%/.test(String(text || ''));
    }

    function isCoordinateNoiseText(text) {
        const value = String(text || '').trim();
        if (!value) return true;
        if (/财富号|基金经理说|市场解读|投资锦囊|产品季报/.test(value)) return true;
        if (/更多产品|销售服务|法律文件|收益数据仅供参考|过往业绩|市场有风险|页面由/.test(value)) return true;
        if (/^(基金市场|机会|自选|持有|全部|偏股|偏债|指数|黄金|全|名称|金额\/昨日收益|持有收益\/率)$/.test(value)) return true;
        return false;
    }

    function isLikelyCoordinateNameText(text) {
        const value = String(text || '').trim();
        if (!value || isCoordinateNoiseText(value)) return false;
        if (/^定投$|^金选|指数基金/.test(value)) return false;
        if (isAmountAnchorText(value) || isSignedNumberText(value) || isPercentText(value)) return false;
        if (/^[A-Z]$/i.test(value)) return true;
        return /[\u4e00-\u9fa5A-Za-z0-9（）()]/.test(value);
    }

    function buildAmbiguousMatch(matches) {
        return {
            ambiguous: true,
            suggestions: matches.slice(0, 6).map(match => ({
                code: match.code,
                name: match.name,
                type: match.type,
                score: match.score
            }))
        };
    }

    function getRowMatchScore(rowName, fundName) {
        if (!rowName || !fundName) return 0;
        if (rowName === fundName) return 1000;

        const rowClass = getVariantClass(rowName);
        const fundClass = getVariantClass(fundName);
        if (rowClass && fundClass && rowClass !== fundClass) return 0;

        const rowBase = getVariantBaseName(rowName);
        const fundBase = getVariantBaseName(fundName);
        if (!rowBase || !fundBase || rowBase.length < 4) return 0;

        if (rowBase === fundBase) return 900 + (rowClass && rowClass === fundClass ? 20 : 0);

        const minReliableLength = Math.max(8, Math.floor(fundBase.length * 0.75));
        if (fundBase.includes(rowBase) && rowBase.length >= minReliableLength) {
            return 700 + rowBase.length;
        }

        if (rowBase.includes(fundBase) && fundBase.length >= minReliableLength) {
            return 680 + fundBase.length;
        }

        const rowTokens = getMeaningfulRowTokens(rowBase);
        if (rowTokens.length >= 2 && rowTokens.every(token => fundBase.includes(token))) {
            const brandBonus = KNOWN_FUND_BRANDS.some(brand => rowBase.startsWith(brand) && fundBase.startsWith(brand)) ? 60 : 0;
            const classBonus = rowClass && rowClass === fundClass ? 20 : 0;
            return 560 + brandBonus + classBonus + rowTokens.join('').length;
        }

        const compactRowBase = compactIndustryAlias(rowBase);
        const compactFundBase = compactIndustryAlias(fundBase);
        if (compactRowBase && compactFundBase && compactRowBase === compactFundBase) {
            const classBonus = rowClass && rowClass === fundClass ? 20 : 0;
            return 820 + classBonus + compactRowBase.length;
        }

        if (compactFundBase.includes(compactRowBase) && compactRowBase.length >= 5) {
            const brandBonus = KNOWN_FUND_BRANDS.some(brand => compactRowBase.startsWith(brand) && compactFundBase.startsWith(brand)) ? 40 : 0;
            const classBonus = rowClass && rowClass === fundClass ? 20 : 0;
            return 640 + brandBonus + classBonus + compactRowBase.length;
        }

        const fuzzyScore = getConstrainedFuzzyScore(compactRowBase, compactFundBase, rowClass, fundClass);
        if (fuzzyScore > 0) return fuzzyScore;

        const compactTokens = getMeaningfulRowTokens(compactRowBase);
        if (compactTokens.length >= 2 && compactTokens.every(token => compactFundBase.includes(token))) {
            const brandBonus = KNOWN_FUND_BRANDS.some(brand => compactRowBase.startsWith(brand) && compactFundBase.startsWith(brand)) ? 60 : 0;
            const classBonus = rowClass && rowClass === fundClass ? 20 : 0;
            return 520 + brandBonus + classBonus + compactTokens.join('').length;
        }

        if (compactTokens.length === 1 && compactTokens[0].length >= 4 && compactFundBase.includes(compactTokens[0])) {
            const sameBrand = KNOWN_FUND_BRANDS.some(brand => compactRowBase.startsWith(brand) && compactFundBase.startsWith(brand));
            const sameConnector = /ETF|联接/i.test(compactRowBase) && /ETF|联接/i.test(compactFundBase);
            if (sameBrand && sameConnector) {
                const classBonus = rowClass && rowClass === fundClass ? 20 : 0;
                return 500 + classBonus + compactTokens[0].length;
            }
        }

        return 0;
    }

    function getConstrainedFuzzyScore(rowBase, fundBase, rowClass, fundClass) {
        if (!rowBase || !fundBase || rowBase.length < 5 || fundBase.length < 5) return 0;
        if (rowClass && fundClass && rowClass !== fundClass) return 0;

        const rowBrand = getKnownBrand(rowBase);
        const fundBrand = getKnownBrand(fundBase);
        if (!rowBrand || rowBrand !== fundBrand) return 0;

        const lengthDelta = Math.abs(rowBase.length - fundBase.length);
        if (lengthDelta > 2) return 0;

        const distance = getLevenshteinDistance(rowBase, fundBase);
        const maxLength = Math.max(rowBase.length, fundBase.length);
        const similarity = 1 - (distance / maxLength);
        if (distance <= 2 && similarity >= 0.78) {
            const classBonus = rowClass && rowClass === fundClass ? 20 : 0;
            return 610 + classBonus + Math.round(similarity * 100);
        }

        return 0;
    }

    function getKnownBrand(value) {
        return KNOWN_FUND_BRANDS
            .filter(brand => String(value || '').startsWith(brand))
            .sort((a, b) => b.length - a.length)[0] || '';
    }

    function getLevenshteinDistance(left, right) {
        const a = Array.from(String(left || ''));
        const b = Array.from(String(right || ''));
        const previous = Array.from({ length: b.length + 1 }, (_, index) => index);

        for (let i = 0; i < a.length; i += 1) {
            const current = [i + 1];
            for (let j = 0; j < b.length; j += 1) {
                const cost = a[i] === b[j] ? 0 : 1;
                current[j + 1] = Math.min(
                    current[j] + 1,
                    previous[j + 1] + 1,
                    previous[j] + cost
                );
            }
            previous.splice(0, previous.length, ...current);
        }

        return previous[b.length];
    }

    function compactIndustryAlias(value) {
        return String(value || '')
            .replace(/公用事业/g, '')
            .replace(/中证全指/g, '')
            .replace(/中证/g, '')
            .replace(/发起式|发起/g, '')
            .replace(/灵活配置|灵活|配置/g, '')
            .replace(/材料/g, '')
            .replace(/主题/g, '')
            .replace(/增强/g, '')
            .replace(/指数/g, '')
            .replace(/债券/g, '')
            .replace(/货币/g, '');
    }

    function getMeaningfulRowTokens(rowBase) {
        return splitNameTokens(rowBase)
            .map(token => token.replace(/联接$/g, ''))
            .filter(token => token.length >= 2)
            .filter(token => !/^(ETF|LOF|QDII|FOF|联接|混合|股票|债券|指数|基金|人民币|美元)$/i.test(token));
    }

    function appendUnmatchedHoldingRows(text, candidates) {
        const rows = extractHoldingRows(text);
        if (rows.length === 0) return candidates;

        const usedAmounts = candidates
            .map(candidate => Number(candidate.amount))
            .filter(value => Number.isFinite(value) && value > 0);
        const merged = [...candidates];

        rows.forEach((row, index) => {
            const amount = Number(row.amount);
            if (!Number.isFinite(amount) || usedAmounts.some(used => Math.abs(used - amount) < 0.01)) return;

            merged.push({
                code: '',
                name: row.name || `无法匹配基金 ${index + 1}`,
                type: '',
                amount: row.amount,
                holdProfit: row.holdProfit,
                unmatched: true
            });
            usedAmounts.push(amount);
        });

        return merged;
    }

    function extractHoldingRows(text) {
        const source = String(text || '');
        const values = [...source.matchAll(/[+-]?\d[\d,，]*(?:\.\d{2})%?/g)]
            .map(match => {
                const end = match.index + match[0].length;
                return {
                    raw: match[0],
                    index: match.index,
                    end,
                    number: normalizeNumber(match[0]),
                    signed: /^[+-]/.test(match[0]),
                    isPercent: match[0].includes('%') || /^%/.test(source.slice(end, end + 3))
                };
            })
            .filter(item => item.number);

        const rows = [];
        values.forEach(value => {
            const amount = Number(value.number);
            if (value.signed || value.isPercent || !Number.isFinite(amount) || amount < 1) return;

            const nextAmount = values.find(item => item.index > value.end && !item.signed && !item.isPercent && Number(item.number) >= 1);
            const windowEnd = nextAmount ? nextAmount.index : Math.min(source.length, value.end + 180);
            const nextValues = values.filter(item => item.index > value.end && item.index < windowEnd);
            const profits = nextValues.filter(item => item.signed && !item.isPercent);
            const rate = nextValues.find(item => item.isPercent);
            if (profits.length < 1 || !rate) return;

            const lowerBound = rows.length ? rows[rows.length - 1].end : 0;
            const holdProfit = profits[0];
            const nextProfit = profits[1] || rate;
            let name = repairTruncatedFundName(extractHoldingNameForAmount(source, lowerBound, value.index, value.end, holdProfit.index));
            const suffixAfterHoldProfit = cleanHoldingNameFragment(source.slice(holdProfit.end, nextProfit.index), false);
            if (isLikelyFundNameSuffix(suffixAfterHoldProfit)) {
                const normalizedName = normalizeFundName(name);
                const normalizedSuffix = normalizeFundName(suffixAfterHoldProfit);
                if (normalizedSuffix && !normalizedName.endsWith(normalizedSuffix)) {
                    name = mergeFundNameSuffix(name, suffixAfterHoldProfit);
                }
            }
            if (!isLikelyHoldingName(name)) return;

            rows.push({
                name,
                truncated: /\.\.\.|…/.test(name),
                amount: value.number,
                holdProfit: holdProfit.number,
                index: value.index,
                end: rate.end
            });
        });

        return rows;
    }

    function extractHoldingNameForAmount(text, rowStart, amountIndex, firstProfitEnd, holdProfitIndex) {
        const beforeAmount = cleanHoldingNameFragment(text.slice(rowStart, amountIndex), true);
        const afterYesterdayProfit = cleanHoldingNameFragment(text.slice(firstProfitEnd, holdProfitIndex), false);
        if (!beforeAmount && !afterYesterdayProfit) return '';

        if (afterYesterdayProfit && beforeAmount.endsWith(afterYesterdayProfit)) return beforeAmount;
        return `${beforeAmount}${afterYesterdayProfit}`.slice(0, 36);
    }

    function repairTruncatedFundName(name) {
        let repaired = String(name || '');

        if (/chRRERF5225C/i.test(repaired)) {
            repaired = repaired.replace(/chRRERF5225C/ig, '中欧颐利债券C');
        }

        if (/纳斯达克ETF(?:EXE|EX|E)?\.{0,3}$/i.test(repaired)) {
            repaired = repaired.replace(/纳斯达克ETF(?:EXE|EX|E)?\.{0,3}$/i, '纳斯达克100ETF联接...');
        }

        repaired = repaired
            .replace(/温合/g, '混合')
            .replace(/(混合|债券|股票|指数|联接|配置|主题)([ABCDEIY])[A-Z]{2,}$/i, '$1$2')
            .replace(/(混合|债券|股票|指数|联接|配置|主题)G$/i, '$1C')
            .replace(/ETFEXE\.{0,3}/ig, 'ETF联接...')
            .replace(/ETFEX\.{0,3}/ig, 'ETF联接...')
            .replace(/ETF联(?=\.{1,3}|$)/g, 'ETF联接');

        return repaired;
    }

    function isLikelyHoldingName(name) {
        const normalized = normalizeFundName(name);
        if (!normalized || normalized.length < 2) return false;
        if (!/[\u4e00-\u9fa5]/.test(normalized)) return false;
        if (/^[A-Z0-9.]+$/i.test(normalized)) return false;
        return true;
    }

    function cleanHoldingNameFragment(fragment, takeTail) {
        let compact = String(fragment || '')
            .replace(/\s+/g, '')
            .replace(/[©@]/g, '|')
            .replace(/今日收益更新/g, '|')
            .replace(/基金财富号|财富号/g, '|')
            .replace(/金选固收[+十]?|金选指数基金/g, '|')
            .replace(/我的持有|持有收益排序|全部|偏股|偏债|黄金/g, '')
            .replace(/名称|金额|昨日收益|持有收益率|持有收益|基金市场|机会|自选|持有/g, '')
            .replace(/投资锦囊|产品季报|限额即将再下调|投近\d?年跑赢纳指/g, '|')
            .replace(/[^\u4e00-\u9fa5A-Za-z0-9.（）()|]+/g, '');

        const chunks = compact.split('|').filter(Boolean);
        compact = chunks.length ? chunks[chunks.length - 1] : compact;
        compact = compact.replace(/^(今日|收益|更新)+/g, '');
        compact = trimToLikelyFundName(compact);

        if (!takeTail) return compact.replace(/[+-]?\d+(?:\.\d+)?$/g, '');
        const tailLength = /纳斯达克|ETF/i.test(compact) ? 28 : 22;
        return compact.length > tailLength ? compact.slice(-tailLength) : compact;
    }

    function trimToLikelyFundName(value) {
        const text = String(value || '');
        if (/^(A|B|C|D|E|I|Y)$/i.test(text)) return text.toUpperCase();

        let bestIndex = -1;
        KNOWN_FUND_BRANDS.forEach(brand => {
            const index = text.lastIndexOf(brand);
            if (index > bestIndex) bestIndex = index;
        });

        const trimmed = bestIndex >= 0 ? text.slice(bestIndex) : text;
        return trimmed
            .replace(/^[0-9.]+(?=[\u4e00-\u9fa5])/g, '')
            .replace(/^(基金|品全率|品人部|全率|到基金|人到基金|基金饼)+/g, '');
    }

    function isLikelyFundNameSuffix(value) {
        const suffix = normalizeFundName(value);
        if (!suffix || suffix.length > 16) return false;
        if (/^(A|B|C|D|E|I|Y)$/i.test(suffix)) return true;
        if (/^接[ABCDEIY]$/i.test(suffix)) return true;
        if (/^[合券][ABCDEIY]$/i.test(suffix)) return true;
        if (/^LOF[ABCDEIY]$/i.test(suffix)) return true;
        if (/^期?国债$/i.test(suffix)) return true;
        if (/^(QDII|FOF)?[ABCDEIY]$/i.test(suffix)) return true;
        if (/^\d{2,4}(QDII)?FOF[ABCDEIY]$/i.test(suffix)) return true;
        if (/^(ETF)?联接[ABCDEIY]?$/i.test(suffix)) return true;
        if (/^(混合|债券|股票|指数|配置|主题|联接|ETF联接)(QDII|FOF)?[ABCDEIY]?$/i.test(suffix)) return true;
        if (/(混合|债券|股票|指数|联接|配置|主题|产业|行业|科技|消费|电力|银行|材料|化工|半导体)(QDII|FOF)?[ABCDEIY]$/i.test(suffix)) return true;
        if (/^\(?(QDII|FOF)\)?[ABCDEIY]?$/i.test(suffix)) return true;
        return false;
    }

    function mergeFundNameSuffix(name, suffix) {
        const normalizedName = normalizeFundName(name);
        const normalizedSuffix = normalizeFundName(suffix);
        const splitConnector = normalizedSuffix.match(/^接([ABCDEIY])$/i);
        if (splitConnector) {
            if (normalizedName.endsWith('联接')) return `${name}${splitConnector[1].toUpperCase()}`;
            if (normalizedName.endsWith('联')) return `${name}接${splitConnector[1].toUpperCase()}`;
        }
        const splitMixed = normalizedSuffix.match(/^合([ABCDEIY])$/i);
        if (splitMixed && normalizedName.endsWith('混')) return `${name}合${splitMixed[1].toUpperCase()}`;

        const splitBond = normalizedSuffix.match(/^券([ABCDEIY])$/i);
        if (splitBond && normalizedName.endsWith('债债')) return `${name.slice(0, -1)}${splitBond[1].toUpperCase()}`;
        if (splitBond && normalizedName.endsWith('债')) return `${name}券${splitBond[1].toUpperCase()}`;

        return `${name}${suffix}`;
    }

    function getVariantBaseName(normalizedName) {
        return String(normalizedName || '')
            .replace(/(QDII|FOF)/g, '')
            .replace(/(人民币|美元)/g, '')
            .replace(/(A|B|C|D|E|I|Y)$/i, '');
    }

    function getVariantClass(normalizedName) {
        const match = String(normalizedName || '').match(/(A|B|C|D|E|I|Y)$/i);
        return match ? match[1].toUpperCase() : '';
    }

    function getVisibleClassForBase(normalizedText, baseName) {
        if (!baseName || baseName.length < 4) return '';
        const index = normalizedText.indexOf(baseName);
        if (index === -1) return '';

        const windowText = normalizedText.slice(index + baseName.length, index + baseName.length + 10);
        const match = windowText.match(/^(A|B|C|D|E|I|Y)/i);
        return match ? match[1].toUpperCase() : '';
    }

    function filterVariantCandidates(candidates, normalizedText) {
        const groups = new Map();

        candidates.forEach(candidate => {
            const baseName = getVariantBaseName(candidate.normalizedName || candidate.name);
            const key = baseName.length >= 4 ? baseName : candidate.normalizedName || candidate.name;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(candidate);
        });

        const filtered = [];
        groups.forEach((group, baseName) => {
            if (group.length === 1) {
                filtered.push(group[0]);
                return;
            }

            const visibleClass = getVisibleClassForBase(normalizedText, baseName);
            if (visibleClass) {
                const classMatches = group.filter(candidate => getVariantClass(candidate.normalizedName) === visibleClass);
                if (classMatches.length > 0) {
                    filtered.push(...classMatches);
                    return;
                }
            }

            filtered.push(...group);
        });

        return filtered.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
    }

    function extractHoldingMetricsForFund(text, normalizedText, fund) {
        const compactText = normalizedText || normalizeFundName(text);
        const fullName = fund.normalizedName;
        const tokens = splitNameTokens(fullName);
        const prefix = tokens.find(token => token.length >= 4) || fullName.slice(0, Math.min(fullName.length, 10));
        const index = compactText.indexOf(fullName) !== -1 ? compactText.indexOf(fullName) : compactText.indexOf(prefix);
        if (index === -1) return { amount: '', holdProfit: '' };

        const rawAnchor = findRawAnchor(text, fund);
        const rawTail = rawAnchor >= 0
            ? text.slice(rawAnchor, rawAnchor + 220)
            : compactText.slice(index + (compactText.indexOf(fullName) !== -1 ? fullName.length : prefix.length), index + 180);

        return extractMetricsFromWindow(rawTail);
    }

    function findRawAnchor(text, fund) {
        const upperText = text.toUpperCase();
        const tokens = splitNameTokens(fund.normalizedName)
            .filter(token => token.length >= 3 && !/^(A|B|C|D|E|I|Y|\d+)$/i.test(token));
        const leading = fund.normalizedName.slice(0, Math.min(fund.normalizedName.length, 8));
        if (leading.length >= 4) tokens.push(leading);

        let bestIndex = -1;
        tokens.forEach(token => {
            const index = upperText.indexOf(token);
            if (index !== -1 && (bestIndex === -1 || index < bestIndex)) bestIndex = index;
        });

        return bestIndex;
    }

    function extractMetricsFromWindow(windowText) {
        const values = [...String(windowText || '').matchAll(/[+-]?\d[\d,，,]*(?:\.\d{2})/g)]
            .map(match => {
                const end = match.index + match[0].length;
                const next = windowText.slice(end, end + 3);
                return {
                    raw: match[0],
                    number: normalizeNumber(match[0]),
                    isPercent: /^%/.test(next)
                };
            })
            .filter(item => item.number && !item.isPercent);

        const unsigned = values.filter(item => !/^[+-]/.test(item.raw) && Number(item.number) > 0);
        const profits = values.filter(item => /^[+-]/.test(item.raw));
        const amount = unsigned.find(item => Number(item.number) >= 1) || unsigned[0];
        const holdProfit = profits[0];

        return {
            amount: amount ? amount.number : '',
            holdProfit: holdProfit ? holdProfit.number : ''
        };
    }

    function applySequentialMetrics(text, candidates) {
        if (!candidates.some(candidate => !candidate.amount)) return;

        const values = [...String(text || '').matchAll(/[+-]?\d[\d,，,]*(?:\.\d{2})/g)]
            .map(match => {
                const end = match.index + match[0].length;
                const next = text.slice(end, end + 3);
                return {
                    raw: match[0],
                    number: normalizeNumber(match[0]),
                    isPercent: /^%/.test(next)
                };
            })
            .filter(item => item.number && !item.isPercent);

        const amounts = values.filter(item => !/^[+-]/.test(item.raw) && Number(item.number) >= 1);
        const profits = values.filter(item => /^[+-]/.test(item.raw));

        candidates.forEach((candidate, index) => {
            if (!candidate.amount && amounts[index]) candidate.amount = amounts[index].number;
            if (!candidate.holdProfit && profits[index * 2]) candidate.holdProfit = profits[index * 2].number;
        });
    }

    function fetchPingzhongNav(code, timeoutMs = 3500) {
        return new Promise(resolve => {
            const script = document.createElement('script');
            script.async = true;
            script.src = `https://fund.eastmoney.com/pingzhongdata/${code}.js?rt=${Date.now()}`;

            let finished = false;
            const cleanup = () => {
                if (script.parentNode) script.parentNode.removeChild(script);
                if (app.utils && app.utils.resetPingzhongGlobals) app.utils.resetPingzhongGlobals();
            };
            const finish = value => {
                if (finished) return;
                finished = true;
                clearTimeout(timerId);
                cleanup();
                resolve(value);
            };

            script.onload = () => {
                const history = window.Data_netWorthTrend;
                if (Array.isArray(history) && history.length > 0) {
                    const latest = history[history.length - 1];
                    const nav = Number(latest && latest.y);
                    finish(Number.isFinite(nav) && nav > 0 ? nav : null);
                } else {
                    finish(null);
                }
            };
            script.onerror = () => finish(null);

            const timerId = setTimeout(() => finish(null), timeoutMs);
            if (app.utils && app.utils.resetPingzhongGlobals) app.utils.resetPingzhongGlobals();
            document.head.appendChild(script);
        });
    }

    function fetchFundgzNav(code, timeoutMs = 3500) {
        return new Promise(resolve => {
            const script = document.createElement('script');
            script.async = true;
            script.src = `https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`;

            let finished = false;
            let timerId = null;
            const previousJsonpgz = window.jsonpgz;

            const cleanup = () => {
                if (script.parentNode) script.parentNode.removeChild(script);
                if (previousJsonpgz === undefined) delete window.jsonpgz;
                else window.jsonpgz = previousJsonpgz;
            };
            const finish = value => {
                if (finished) return;
                finished = true;
                if (timerId) clearTimeout(timerId);
                cleanup();
                resolve(value);
            };

            window.jsonpgz = data => {
                if (typeof previousJsonpgz === 'function') {
                    try {
                        previousJsonpgz(data);
                    } catch (error) {
                        console.warn('previous jsonpgz callback failed', error);
                    }
                }
                const nav = Number(data && (data.dwjz || data.gsz));
                finish(Number.isFinite(nav) && nav > 0 ? nav : null);
            };

            script.onload = () => {
                setTimeout(() => finish(null), 0);
            };
            script.onerror = () => finish(null);

            timerId = setTimeout(() => finish(null), timeoutMs);
            document.head.appendChild(script);
        });
    }

    async function fetchLatestNav(code) {
        const pingzhongNav = await fetchPingzhongNav(code);
        if (pingzhongNav) return pingzhongNav;

        const fundgzNav = await fetchFundgzNav(code);
        if (fundgzNav) return fundgzNav;

        return null;
    }

    function parseAlipayFundText(rawText, ocrBlocks) {
        const text = normalizeOcrText(rawText);
        const blocks = Array.isArray(ocrBlocks) ? ocrBlocks : [];

        if (looksLikeHoldingsList(text) && !hasDetailFields(text)) {
            return {
                code: '',
                shares: '',
                cost: '',
                candidates: [],
                pageType: 'holdingsList',
                rawText: text,
                ocrBlocks: blocks,
                message: '这是持有列表页，已尝试按名称匹配基金代码。'
            };
        }

        const filteredText = stripKnownNoise(text);

        return {
            code: extractCode(filteredText),
            shares: extractNumberAfter(filteredText, ['持有份额', '持仓份额', '持有份额(份)', '持有份额（份）', '份额']),
            cost: extractNumberAfter(filteredText, ['持仓成本价', '持有成本价', '成本价', '持仓成本', '持有成本', '成本']),
            candidates: [],
            pageType: hasDetailFields(filteredText) ? 'fundDetail' : 'unknown',
            rawText: filteredText,
            ocrBlocks: blocks,
            message: ''
        };
    }

    async function enrichFundCandidates(parsed) {
        if (parsed.code) return parsed;

        let catalog = [];
        try {
            catalog = await loadFundCatalog();
        } catch (error) {
            return {
                ...parsed,
                candidates: [],
                catalogError: error.message || '基金代码表加载失败',
                message: '已读取截图文字，但基金代码表加载失败，无法按名称匹配代码。'
            };
        }

        const candidates = findFundCandidates(parsed.rawText || '', catalog, parsed.ocrBlocks);
        const enriched = { ...parsed, candidates, catalogSize: catalog.length };

        if (candidates.length === 1) {
            enriched.code = candidates[0].code;
            enriched.matchedName = candidates[0].name;
            enriched.amount = candidates[0].amount;
            enriched.holdProfit = candidates[0].holdProfit;
        }

        return enriched;
    }

    async function recognizeAlipayScreenshot(file, onProgress) {
        if (!window.Tesseract || typeof window.Tesseract.recognize !== 'function') {
            throw new Error('OCR 引擎未加载');
        }

        const result = await window.Tesseract.recognize(file, 'chi_sim+eng', {
            logger(message) {
                if (message.status === 'recognizing text' && typeof onProgress === 'function') {
                    onProgress(Math.round((message.progress || 0) * 100));
                }
            }
        });

        const parsed = parseAlipayFundText(result.data && result.data.text);
        const enriched = await enrichFundCandidates(parsed);
        return {
            ...enriched,
            ocrTextLength: String(result.data && result.data.text || '').trim().length
        };
    }

    async function recognizeServerScreenshot(file, onProgress) {
        if (typeof onProgress === 'function') onProgress(12, '正在上传到服务端 OCR');

        const formData = new FormData();
        formData.append('image', file);

        const response = await fetch('/api/ocr/recognize', {
            method: 'POST',
            body: formData
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) {
            const error = new Error(payload.error || '服务端 OCR 不可用');
            error.backendUnavailable = true;
            throw error;
        }

        if (typeof onProgress === 'function') onProgress(80, `服务端 OCR 已完成：${payload.engine || 'server'}`);
        const rawText = payload.text || '';
        const parsed = parseAlipayFundText(rawText, payload.blocks || []);
        const enriched = await enrichFundCandidates(parsed);
        return {
            ...enriched,
            ocrEngine: payload.engine || 'server',
            ocrTextLength: String(rawText).trim().length
        };
    }

    async function recognizeBestAlipayScreenshot(file, onProgress) {
        try {
            return await recognizeServerScreenshot(file, onProgress);
        } catch (error) {
            console.warn('server OCR unavailable, falling back to Tesseract', error);
            if (typeof onProgress === 'function') onProgress(8, '服务端 OCR 不可用，改用浏览器 OCR');
            const result = await recognizeAlipayScreenshot(file, onProgress);
            return {
                ...result,
                ocrEngine: 'tesseract.js',
                backendFallbackReason: error.message || '服务端 OCR 不可用'
            };
        }
    }

    app.ocr = {
        parseAlipayFundText,
        findFundCandidates,
        fetchLatestNav,
        recognizeAlipayScreenshot,
        recognizeServerScreenshot,
        recognizeBestAlipayScreenshot
    };
})();
