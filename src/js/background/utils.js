import { getRules, getRulesDate, refreshRules } from '../common/rules';
import { commandSandbox } from '../common/utils';
import { getConfig } from '../common/config';
let config;
let rules = {};
import RSSParser from 'rss-parser';
const rssParser = new RSSParser();

window.pageRSS = {};
window.pageRSSHub = {};
window.websiteRSSHub = {};

function schedule(time = +new Date() + config.refreshTimeout * 1000) {
    chrome.alarms.create('refreshRules', {
        when: time,
        periodInMinutes: config.refreshTimeout / 60,
    });
}

function initSchedule() {
    getRulesDate((lastDate) => {
        if (!lastDate || +new Date() - lastDate > config.refreshTimeout * 1000) {
            refreshRules();
            schedule();
        } else {
            schedule(lastDate + config.refreshTimeout * 1000);
        }
    });
}

chrome.storage.onChanged.addListener((result) => {
    if (result.config) {
        config = result.config.newValue;
    }
    if (result.rules) {
        getRules((rul) => {
            rules = rul;
        });
    }
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'refreshRules') {
        refreshRules();
    }
});

chrome.idle.onStateChanged.addListener((newState) => {
    if (newState === 'active') {
        initSchedule();
    }
});

getConfig((conf) => {
    config = conf;

    getRules((rul) => {
        rules = rul;
        initSchedule();
    });
});

chrome.browserAction.setBadgeBackgroundColor({
    color: '#FF2800',
});

chrome.browserAction.setBadgeTextColor &&
    chrome.browserAction.setBadgeTextColor({
        color: '#fff',
    });

/**
 * 设置插件RSS订阅源气泡提示文本
 */
function setBadge(tabId) {
    chrome.storage.local.get('cruiseSubList', function (result) {
        const subList = result.cruiseSubList;
        if (subList === undefined || subList.length === 0) {
            setBadgeTextImpl(tabId, '#FF2800');
            return;
        }
        const channels = window.pageRSS[tabId];
        if (havingChannelUnsubscribed(channels, subList)) {
            setBadgeTextImpl(tabId, '#E1E100');
            return;
        }
        if (allChannelSubscribed(channels, subList)) {
            setBadgeTextImpl(tabId, '#008000');
        } else {
            setBadgeTextImpl(tabId, '#FF2800');
        }
    });
}

/**
 * 是否包含订阅后又取消订阅的频道
 * 决定提示气泡显示颜色
 * 订阅后又取消订阅显示黄色
 * 只要包含任意一个订阅后取消订阅显示黄色
 * @param {*} channels
 * @param {*} subList
 * @returns
 */
function havingChannelUnsubscribed(channels, subList) {
    if (channels === undefined || channels.length === 0 || subList === undefined || subList.length === 0) {
        return false;
    }
    let havingUnsubcribe = false;
    const subListUrl = subList.map((item) => item.subUrl);
    channels.forEach((channel) => {
        const isContains = subListUrl.indexOf(channel.url);
        if (isContains > 0) {
            const subListItem = subList.find((item) => item.subUrl === channel.url);
            if (subListItem.userSubStatus === -1) {
                havingUnsubcribe = true;
                return;
            }
        }
    });
    return havingUnsubcribe;
}

/**
 * 是否订阅过所有频道
 * 决定提示气泡显示颜色
 * 如果已经订阅，用户则可直接忽略，节省时间
 *
 * 有的rss源链接结尾会有斜线，类似：https://www.si.com/.rss/full/
 * 为了避免特殊逻辑处理，所以规定以不带斜线的为标准
 * 数据存储，验证都以链接结尾不带斜线为标准格式
 *
 * @param {*} channels
 * @param {*} subList
 * @returns
 */
function allChannelSubscribed(channels, subList) {
    if (channels === undefined || channels.length === 0 || subList === undefined || subList.length === 0) {
        return false;
    }
    let allSubcribe = true;
    const subListUrl = subList.map((item) => item.subUrl);
    channels.forEach((channel) => {
        const isContains = subListUrl.indexOf(channel.url);
        // 订阅源链接末尾带斜杠和不带斜杠皆认为是一样的订阅连接
        const channelMatchUrl = channel.url.endsWith('/') ? channel.url.substring(0, channel.url.length - 1) : channel.url + '/';
        const isContainsMatch = subListUrl.indexOf(channelMatchUrl);
        // 当前识别协议类型为http，已经订阅类型为https皆认为是一样的链接
        // 当前识别的协议为https，已经订阅类型为http是不一样的链接，用https替换http
        // https://stackoverflow.com/questions/736513/how-do-i-parse-a-url-into-hostname-and-path-in-javascript
        const parser = document.createElement('a');
        parser.href = channel.url;
        const channelSecUrl = parser.protocol === 'http:' ? channel.url.replace('http://', 'https://') : channel.url;
        const isSecContain = subListUrl.indexOf(channelSecUrl);
        if (isContains < 0 && isContainsMatch < 0 && isSecContain < 0) {
            allSubcribe = false;
            return allSubcribe;
        }
    });
    return allSubcribe;
}

function setBadgeTextImpl(tabId, color) {
    const pageRssCount = window.pageRSS[tabId] ? window.pageRSS[tabId].length : 0;
    const pageRSSHubCount = window.pageRSSHub[tabId] ? window.pageRSSHub[tabId].length : 0;
    const websiteRSSHubCount = window.websiteRSSHub[tabId] && window.websiteRSSHub[tabId].length ? ' ' : '';
    setBackgroundColor(color);
    chrome.browserAction.setBadgeText({
        text: config.notice.badge ? (pageRssCount + pageRSSHubCount || websiteRSSHubCount) + '' : '',
        tabId,
    });
}

function setBackgroundColor(color) {
    /*
    如果已经订阅频道，显示绿色
    如果未订阅频道，显示红色
    如果有订阅后又取消订阅的频道，显示黄色
    又任意一个订阅后又取消订阅的频道即显示黄色
    有一个URL未订阅即未订阅，所有URL订阅算已订阅
    */
    chrome.browserAction.setBadgeBackgroundColor({
        color: color,
    });
}

function getPageRSSHub(url, tabId, done) {
    chrome.tabs.sendMessage(
        tabId,
        {
            text: 'getHTML',
        },
        (html) => {
            commandSandbox(
                'getPageRSSHub',
                {
                    url,
                    html,
                    rules,
                },
                done
            );
        }
    );
}

function getWebsiteRSSHub(url, done) {
    commandSandbox(
        'getWebsiteRSSHub',
        {
            url,
            rules,
        },
        done
    );
}

export function handleRSS(feeds, tabId, useCache) {
    if (useCache && window.pageRSS[tabId]) {
        setBadge(tabId);
    } else {
        chrome.tabs.get(tabId, (tab) => {
            feeds &&
                feeds.forEach((feed) => {
                    feed.image = tab.favIconUrl || feed.image;
                });
            window.pageRSS[tabId] = (feeds && feeds.filter((feed) => !feed.uncertain)) || [];
            getWebsiteRSSHub(tab.url, (feeds) => {
                window.websiteRSSHub[tabId] = feeds || [];
                setBadge(tabId);
            });
            getPageRSSHub(tab.url, tabId, (feeds) => {
                window.pageRSSHub[tabId] = feeds || [];
                setBadge(tabId);
            });
        });

        feeds &&
            feeds
                .filter((feed) => feed.uncertain)
                .forEach((feed) => {
                    rssParser.parseURL(feed.url, (err, result) => {
                        if (!err) {
                            feed.title = result.title;
                            window.pageRSS[tabId].push(feed);
                            setBadge(tabId);
                        }
                    });
                });
    }
}

export function removeRSS(tabId) {
    delete window.pageRSS[tabId];
    delete window.websiteRSSHub[tabId];
    delete window.pageRSSHub[tabId];
}

export function addPageRSS(feed, tabId) {
    if (feed) {
        chrome.tabs.get(tabId, (tab) => {
            feed.image = tab.favIconUrl || feed.image;
            window.pageRSS[tabId].push(feed);
            setBadge(tabId);
        });
    }
}

export function getAllRSS(tabId) {
    return {
        pageRSS: window.pageRSS[tabId] || {},
        websiteRSSHub: window.websiteRSSHub[tabId] || {},
        pageRSSHub: window.pageRSSHub[tabId] || {},
    };
}
