import type { TelegramSongWithFiles } from "../types/types";
import { formatDuration } from "../tools/formatDuration";
import { hashtagify } from "../tools/hashtagify";
import type { Bot } from "grammy";

export async function sendSongToChannel(
  bot: Bot,
  chatId: number,
  song: TelegramSongWithFiles
) {
  const artists = JSON.parse(song.artists as unknown as string);
  const captionArray: string[] = [];

  captionArray.push(`🎵 <b>${song.title}</b>`);
  if (artists.length > 1) {
    const artistText = artists
      .map(
        (a: any) =>
          `<a href="https://t.me/deybalalirbot?start=a_${a.id}">${a.name}</a>`
      )
      .join(" و ");
    captionArray.push(`👤 <b>خواننده ها:</b> ${artistText}`);
  } else {
    captionArray.push(
      `👤 <b>خواننده:</b> <a href="https://t.me/deybalalirbot?start=a_${artists[0].id}">${song.artist}</a>`
    );
  }
  captionArray.push(`⏳ <b>زمان:</b> ${formatDuration(song.duration)}`);
  captionArray.push(
    `📊 <b>بازدیدها:</b> ${(song.playCount ?? 0).toLocaleString()}`
  );

  captionArray.push(`🎤 ${hashtagify(song.artist)}`);
  captionArray.push(`🎵 ${hashtagify(song.title)}\n#deybalal #دی_بلال`);
  captionArray.push(` `);
  captionArray.push(` `);
  captionArray.push(`@deybalalir`);

  const caption = captionArray.filter(Boolean).join("\n");

  const message = await bot.api.sendPhoto(
    chatId,
    song.telegram.coverArt?.fileId || "",
    {
      caption,
      parse_mode: "HTML",
    }
  );

  return message;
}
