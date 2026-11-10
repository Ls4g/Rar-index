import assert from "node:assert/strict";
import {
  hasMatchingVolume, isPlausibleLiveListing, isPublicLiveListing,
  listingConflictsWithEdition, listingNamesOtherVolume,
} from "../lib/liveListings.ts";

// The live failure this guards: on 9 November 2026 the public page for
// JoJo's Bizarre Adventure Vol. 5 (VIZ, 2006, ISBN 9781421506548) showed five
// "Part 5" listings for volumes 1, 4, 5, 6 and 9 as copies of that edition.
const jojo5 = {
  title: "JoJo's Bizarre Adventure, Volume 5", series: "JoJo's Bizarre Adventure", volume_number: 5,
  publisher: "VIZ Media", isbn_13: "9781421506548", language: "English", format: null,
};
const liveTitles = [1, 4, 6, 9].map((volume) => `📚 Jojo's Bizarre Adventure Part 5 Vol. ${volume} Official English Manga`);

for (const title of liveTitles) {
  assert.equal(hasMatchingVolume(title, 5), false, `arc number is not the volume: ${title}`);
  assert.notEqual(listingNamesOtherVolume(title, 5), null, `names another volume: ${title}`);
  assert.equal(listingConflictsWithEdition(title, jojo5), true, `conflicts: ${title}`);
  assert.equal(isPublicLiveListing({ listing_title: title, review_status: "watching" }, jojo5), false, `Watching no longer publishes: ${title}`);
  assert.equal(isPublicLiveListing({ listing_title: title, review_status: "new" }, jojo5), false);
}

// The reverse error: the real volume beside an arc number was read as a conflict.
const part3vol5 = "JoJo's Bizarre Adventure Part 3 Vol. 5 VIZ";
assert.equal(hasMatchingVolume(part3vol5, 5), true);
assert.equal(listingNamesOtherVolume(part3vol5, 5), null);
assert.equal(listingConflictsWithEdition(part3vol5, jojo5), false);
assert.equal(isPlausibleLiveListing({ listing_title: part3vol5 }, jojo5), true);

// "Part N" still counts as the volume when nothing else names one.
const akira1 = { title: "Akira", series: "Akira", volume_number: 1, publisher: "Kodansha", isbn_13: null, language: "English", format: null };
assert.equal(hasMatchingVolume("Akira Part 1 Kodansha paperback", 1), true);
assert.equal(listingNamesOtherVolume("Akira Part 2 Kodansha", 1), "2");
assert.equal(listingConflictsWithEdition("Akira Part 2 Kodansha", akira1), true);

// Existing volume forms are untouched.
assert.equal(hasMatchingVolume("Naruto Vol. 7 VIZ", 7), true);
assert.equal(hasMatchingVolume("Naruto Volume 07", 7), true);
assert.equal(hasMatchingVolume("One Piece #3", 3), true);
assert.equal(hasMatchingVolume("ワンピース 1巻 初版", 1), true);
assert.equal(hasMatchingVolume("Naruto Vol. 8", 7), false);
assert.equal(hasMatchingVolume("Naruto Vol. 1-7 lot", 7), false);

// A Watching lead with nothing against it is still shown; a dismissed one never is.
const onePiece1 = { title: "One Piece", series: "One Piece", volume_number: 1, publisher: "VIZ Media", isbn_13: "9781569319017", language: "English", format: "Paperback" };
assert.equal(isPublicLiveListing({ listing_title: "One Piece Vol 1 manga", review_status: "watching" }, onePiece1), true);
assert.equal(isPublicLiveListing({ listing_title: "One Piece Vol 2 manga", review_status: "watching" }, onePiece1), false);
assert.equal(isPublicLiveListing({ listing_title: "One Piece Vol. 1 VIZ Media", review_status: "dismissed" }, onePiece1), false);

console.log("Listing part/volume matching: passed");

// Outbound eBay links carry no search keywords or tracking tokens.
const { publicListingUrl } = await import("../lib/liveListings.ts");
assert.equal(publicListingUrl("https://www.ebay.com/itm/318816683408?_skw=JoJo%27s+Bizarre+Adventure+manga+Vol.+5+English+9781421506548&hash=item4a3af48590:g:YWsAAeSwvW9qmJVL"), "https://www.ebay.com/itm/318816683408");
assert.equal(publicListingUrl("https://www.ebay.co.uk/itm/some-title/206568883646?nordt=true"), "https://www.ebay.co.uk/itm/206568883646");
assert.equal(publicListingUrl("https://www.example.com/sale?id=1"), "https://www.example.com/sale?id=1");
assert.equal(publicListingUrl("not a url"), "not a url");
console.log("Public listing links: passed");
