import * as t from "../lib/index.js";
import glob from "glob";
import { readFileSync } from "fs";
import { inspect } from "util";
import { commonJS, IS_BABEL_8 } from "$repo-utils";
import path from "path";

const { __dirname } = commonJS(import.meta.url);

const files = glob.sync("../../babel-parser/test/**/output.json", {
  cwd: __dirname,
  absolute: true,
  ignore: ["**/estree/**", "**/is-expression-babel-parser/**"],
});

const ignoredFields = {
  ArrowFunctionExpression: { id: true },
  ClassMethod: { id: true, predicate: true },
  ClassPrivateMethod: { id: true, predicate: true },
  ClassPrivateProperty: { declare: true, optional: true },
  ObjectProperty: { method: true },
  ObjectMethod: { method: true, id: true, predicate: true },
  TSDeclareMethod: { id: true },
};

describe("NODE_FIELDS contains all fields, and the visitor order is correct, in", function () {
  const reportedVisitorOrders = new Set();
  const testingOnBabel8 = IS_BABEL_8();
  const { traverseFast, VISITOR_KEYS } = t;

  it.each(files)("%s", async file => {
    const fixturePath = path.dirname(file);
    let isBabel8Test;
    try {
      isBabel8Test = JSON.parse(
        readFileSync(path.join(fixturePath, "options.json")),
      ).BABEL_8_BREAKING;
    } catch {
      if (isBabel8Test === undefined) {
        try {
          isBabel8Test = JSON.parse(
            readFileSync(path.resolve(fixturePath, "../options.json")),
          ).BABEL_8_BREAKING;
        } catch {
          isBabel8Test = true;
        }
      }
    }
    if (isBabel8Test !== testingOnBabel8) return;

    const ast = JSON.parse(readFileSync(file, "utf8"));
    if (ast.type === "File" && ast.errors && ast.errors.length) return;
    t[`assert${ast.type}`](ast);
    let missingFields = null;
    traverseFast(ast, node => {
      const { type } = node;
      switch (type) {
        case "File":
        case "CommentBlock":
        case "CommentLine":
          return;
      }

      if (ignoredFields[type] === true) return;
      const fields = t.NODE_FIELDS[type];
      if (!fields) {
        if (missingFields === null) missingFields = {};
        if (!missingFields[type]) {
          missingFields[type] = {
            MISSING_TYPE: true,
          };
        }
        return;
      }
      for (const field in node) {
        switch (field) {
          case "type":
          case "start":
          case "end":
          case "loc":
          case "range":
          case "leadingComments":
          case "innerComments":
          case "trailingComments":
          case "comments":
          case "extra":
            continue;
        }
        if (!fields[field]) {
          if (ignoredFields[type] && ignoredFields[type][field]) continue;
          if (missingFields === null) missingFields = {};
          if (!missingFields[type]) missingFields[type] = {};
          if (!missingFields[type][field]) {
            missingFields[type][field] = true;
          }
        }
      }

      if (missingFields !== null) {
        throw new Error(
          `The following NODE_FIELDS were missing: ${inspect(missingFields)}`,
        );
      }

      if (type === "ObjectTypeInternalSlot" || type === "ObjectTypeProperty") {
        // We don't validate the visitor order of ObjectTypeInternalSlot and
        // ObjectTypeProperty because their fields' locations intersect. In
        //    interface { [[foo]](): X }
        // there is a field "key" covering `foo`, and a field "value" covering
        // `[[foo]](): X`. Same for `interface { get foo(): X }`.
        // The defined visitor order is that they key is visited first.
        return;
      }

      const keys = VISITOR_KEYS[type];
      for (let prev, i = 0; i < keys.length; i++) {
        if (!node[prev]) {
          prev = keys[i];
          continue;
        }
        const curr = keys[i];
        if (!node[curr]) continue;

        if (node[prev].start > node[curr].start) {
          const errorKey = `${type}-${prev}-${curr}`;
          if (!reportedVisitorOrders.has(errorKey)) {
            reportedVisitorOrders.add(errorKey);
            throw new Error(
              `The visitor order of ${type} is incorrect: ${prev}, ${curr}`,
            );
          }
        }
        prev = curr;
      }
    });
  });
});
