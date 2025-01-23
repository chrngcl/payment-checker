// Library
const axios = require('axios');
const cheerio = require('cheerio');
const qs = require('qs');

// Cookie storage
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

// Helper
const Helper = require('./helper.js');

// Function
class Magento {
  static #jar = new CookieJar();
  static #client = wrapper(axios.create({ jar: this.#jar }));

  static async #extract_product_api(url) {
    let api_url;
    let store_id;

    try {
      const response = await axios.get(url);
      const html = response.data;

      if (!html.includes('/static/')) {
        return false;
      }

      const $ = cheerio.load(html);

      $('script').each((i, script) => {
        const content = $(script).html();
        if (content) {
          const api_url_match = content.match(/"updateRequestConfig":{"url":"(.*?)"}/);
          if (api_url_match) {
            api_url = api_url_match[1].replace(/\\\//g, '/');
          }

          const store_id_match = content.match(/"storeId":"(.*?)"/);
          if (store_id_match) {
            store_id = store_id_match[1];
          }

          if (api_url && store_id) {
            return false;
          }
        }
      });

      if (api_url && store_id) {
        return [api_url, store_id];
      } else {
        return false;
      }
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  static async #grab_product_item(product_info, store_id) {
    try {
      for (let i = 0; i <= 25; i++) {
        const response = await axios.get(product_info, {
          params: {
            'searchCriteria[filter_groups][0][filters][0][field]': 'name',
            'searchCriteria[filter_groups][0][filters][0][value]': '%%',
            'searchCriteria[filter_groups][0][filters][0][condition_type]': 'like',
            'searchCriteria[currentPage]': i,
            'searchCriteria[pageSize]': 100,
            storeId: store_id,
            currencyCode: 'USD'
          },
          timeout: 60000
        });

        const products = response.data.items;
        for (const product of products) {
          const btn = product.add_to_cart_button;
          const price_info = product.price_info.final_price;
          const type = product.type;
          const active = product.is_salable;

          if (btn && btn.required_options == false && price_info != 0 && type == 'simple' && active == '1') {
            const url_status = await Helper.url_status(product.url);

            if (url_status) {
              return product.url;
            }
          }
        }
      }

      return false;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  static async #grab_payload(url) {
    let checkout_page;
    let form_input = {};

    try {
      const response = await this.#client.get(url);
      const $ = cheerio.load(response.data);

      const checkout_element = $("a.action.showcart").first();
      if (checkout_element.length > 0) {
        const base_url = checkout_element.attr('href');
        checkout_page = base_url.replace('cart/', '');
      }

      const form = $("div.product-add-form");
      if (form.length === 0) {
        return false;
      }

      const form_element = form.find('form').first();
      if (form_element.length === 0) {
        return false;
      }

      const form_url = form_element.attr('action') || url;
      const form_fields = form_element.find('input');

      form_fields.each((index, element) => {
        const name = $(element).attr('name');
        const value = $(element).attr('value') || '';
        if (name) {
          form_input[name] = value;
        }
      });

      form_input['qty'] = form_input['qty'] === '0' ? '1' : form_input['qty'];

      const form_key = response.data.match(/form_key" type="hidden" value="(.*?)"/);
      if (form_key && form_key[1]) {
        if (!form_input['form_key']) {
          form_input['form_key'] = form_key[1];
        }
      }

      const payload = qs.stringify(form_input);
      const post = await this.#client.post(form_url, payload, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': `form_key=${form_key[1]}`,
        }
      });

      const response_cookie = await this.#jar.getCookies(url);
      const response_success = response_cookie.some(cookie => cookie.key === 'mage-messages' && cookie.value.includes('success'));

      if (response_success) {
        const get_checkout = await this.#grab_checkout_details(url, checkout_page);
        if (get_checkout && get_checkout[0]) {
          const pm_source = await this.#grab_payment_details(get_checkout[0], get_checkout[1]);
          return [url, pm_source, get_checkout[2]];
        }
      } else {
        return false;
      }
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  static async #grab_checkout_details(url, checkout_url) {
    let captcha_bool = false;
    const filter_words = ['sitekey', 'siteKey'];

    try {
      if (!checkout_url || !/^https?:\/\/.+\..+/i.test(checkout_url)) {
        checkout_url = new URL('/checkout', url).href;
      }

      const response = await this.#client.get(checkout_url, {
        maxRedirects: 5,
      });

      const result = response.data;
      const raw_id = result.match(/quoteData":{"entity_id":"(.*?)"/);
      const raw_api = result.match(/updateRequestConfig":{"url":"(.*?)V1/);

      const filter = new RegExp(filter_words.join('|'), 'i');
      captcha_bool = filter.test(result);

      const id = raw_id ? raw_id[1] : null;
      const api = raw_api ? raw_api[1].replace(/\\\//g, '/') : null;

      if (id) {
        return [id, api, captcha_bool];
      } else {
        return false;
      }
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  static async #grab_payment_details(id, api) {
    try {
      const information = `${api}V1/guest-carts/${id}/payment-information`;

      const response = await this.#client.get(information);
      if (!response.status == 200) {
        return false;
      }

      const data = response.data;
      if (data.payment_methods && data.payment_methods.length > 0) {
        return data.payment_methods.map(method => method.code).join(', ');
      } else {
        return false;
      }

    } catch (error) {
      console.error(error);
      return false;
    }
  }

  static async main(url) {
    url = Helper.url_base(url);

    try {
      const api = await this.#extract_product_api(url);
      if (api && api[0]) {
        const product_link = await this.#grab_product_item(api[0], api[1]);
        if (product_link) {
          const payment = await this.#grab_payload(product_link);
          if (payment && payment[1] != null) {
            return {
              item_url: payment[0],
              payment_sources: payment[1],
              captcha_status: payment[2],
            };
          } else {
            return { status: 'error', message: 'Failed to find a payment source.' };
          }
        } else {
          return { status: 'error', message: 'Failed to find a product link.' };
        }
      } else {
        return { status: 'error', message: 'Failed to find a specific string.' };
      }
    } catch (error) {
      console.error(error);
      return { status: 'error', message: 'An error has occured.' };
    } finally {
      await this.#jar.removeAllCookies();
    }
  }
}

module.exports = Magento;