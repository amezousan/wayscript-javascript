/***
 * Enviroment Variables
 */
const target_date    = variables["TARGET_DATE"] || undefined; // optional
const bot_id         = variables["BOT_ID"];                   // optional
const slack_token    = variables["SLACK_TOKEN"];              // required
let slack_webhook    = variables["SLACK_WEBHOOK"];            // required
let slack_channel_id = variables["SLACK_CHANNEL_ID"];         // required

/***
 * Load Modules
 *  - moment@^2.29.1
 *  - @slack/webhook@^5.0.3
 */
const moment              = require('moment');
const { IncomingWebhook } = require('@slack/webhook');

/***
 * Function Variables
 */
const today              = moment(target_date).utc();
const moment_last_day    = moment(today).add(-14, 'days')
const slack_oldest       = moment_last_day.format("X");
const formatted_today    = today.toISOString();
const formatted_last_day = moment_last_day.toISOString();

console.log("Search Channel for specific stamp FROM: %s TO: %s", formatted_today, formatted_last_day);

/***
 * User Config Variables
 */
const slack_offset_limit = 500;
const target_reaction    = "zumi";
// Must order old -> new
const slack_text_array = [
  {"targetDay": 7, "slackText": ":boom: 未解決のまま一週間以上が経過。直接話した方が早いかも :boom:"},
  {"targetDay": 3, "slackText": ":kami: 未解決のまま3日以上が経過。至急回答を求む :kami:"},
  {"targetDay": 2, "slackText": ":fire: 未解決のまま2日が経過。早めの回答を！ :fire:"},
  {"targetDay": 1, "slackText": ":yatteiki: 未解決のまま1日が経過。回答しよ〜！ :yatteiki:"},
  {"targetDay": 0, "slackText": ":dart: 新着の質問です！ :dart:"}
];

const main = async () => {
  
    const webhook = new IncomingWebhook(slack_webhook);
    
    // What to do?
    // Fetch conversation history in channel id
    // Check if it's messages[].user is not Bot
    // Check if it's messages[].subtype is "thread_broadcast" or undefined.
    // Check if it's messages.reactions[].name is NOT $target_reaction
    //   -> No reactions
    //   -> No $target_reaction
    //   -> Include the rest of items in case of missing something
    // Get Permanent link: https://api.slack.com/methods/chat.getPermalink
    // Notify Slack with the links

    // Fetch conversation history in channel id
    const conversationHistory = await fetch(`https://slack.com/api/conversations.history?token=${slack_token}&channel=${slack_channel_id}&limit=${slack_offset_limit}&oldest=${slack_oldest}`)
      .then((res) => {
        return res.text();
      })
      .catch((err) => console.error(err));
    let parsedConversationHistory = JSON.parse(conversationHistory)
    
    if (typeof(parsedConversationHistory.messages) === "undefined") {
      console.log("Exit since there is no available message.")
      return false
    }
    let unresolvedQuestions = [];

    for(let i = 0; i < parsedConversationHistory.messages.length; i++) {
      let message = parsedConversationHistory.messages[i];

      // Check if it's messages[].user is not Bot
      if ( message.user === bot_id )
        continue
      
      // Check if it's messages[].subtype is "thread_broadcast" or undefined.
      if ( typeof(message.subtype) !== "undefined") {
        if (message.subtype !== "thread_broadcast")
          continue;
      }
      // Check if it's messages.reactions[].name is NOT $target_reaction
      // -> No reactions
      if ( typeof(message.reactions) === "undefined" ) {
        unresolvedQuestions.push(message.ts)
        continue
      }
      // -> No $target_reaction
      let isResolved = false;
      for(let i = 0; i < message.reactions.length; i++) {
        if( message.reactions[i].name === target_reaction ) {
          isResolved = true;
          break;
        }
      }
      if (isResolved) 
        continue;
      
      // -> Include the rest of items in case of missing something
      unresolvedQuestions.push(message.ts)
    };

    console.log("=== Target Questions: ", unresolvedQuestions)

    // Get Permanent link: https://api.slack.com/methods/chat.getPermalink
    let permanentLinkTargets = [];

    unresolvedQuestions.forEach(timestamp => {
      permanentLinkTargets.push({ts: timestamp, url: `https://slack.com/api/chat.getPermalink?token=${slack_token}&channel=${slack_channel_id}&message_ts=${timestamp}`})
    })

    // Ref: https://javascript.info/promise-api#promise-allsettled
    const allLinks = await Promise.allSettled(permanentLinkTargets.map((obj) =>
      fetch(obj.url)
      .then((resp) => {
        return resp.text()
      })
      .catch((err) => console.error(err))
    ));

    let slackLinks = [];
    console.log("=== Permanent Links: ", allLinks)
    allLinks.map((link, index) => {
        let parsedResp = JSON.parse(link.value);
        let replacedResp = parsedResp.permalink.replace(/\\/g, '');
        let slack_text = `- <${replacedResp}|未解決の質問${index + 1}> `;
        for(let i = 0; i < slack_text_array.length; i++) {
          const oneDaySec         = 24*60*60;
          const targetDaySecTotal = oneDaySec*slack_text_array[i].targetDay;
          const diffSecFromToday  = today.format("X") - permanentLinkTargets[index].ts;
          // Any timestamp should hit at least :)
          if(diffSecFromToday >= targetDaySecTotal) {
            slack_text += slack_text_array[i].slackText;
            break;
          }
        };
        slackLinks.push({index: index+1, link: slack_text})
    })
    // Sort Z to A
    slackLinks.sort(function(a,b) {
      return b.index - a.index;
    });

    let slack_text = "";
    slackLinks.forEach(elem => {
      slack_text += elem.link + "\n";
    })

    // Notify Slack with the links
    await webhook.send({
        text: `<#${slack_channel_id}> - 以下は :${target_reaction}: でない質問一覧です。(期間: ${formatted_last_day} - ${formatted_today})`,
        attachments: [{"text": slack_text }]
    });

    return true;
}

main();
